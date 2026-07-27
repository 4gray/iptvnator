/* eslint-disable max-lines -- route connection recovery state is intentionally kept in one owner */
import { DestroyRef, Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import {
    StalkerSessionRecoveryRequest,
    StalkerSessionService,
} from '@iptvnator/portal/stalker/data-access';
import { STALKER_RECIPE_CLASSIFIER_VERSION } from '@iptvnator/portal/stalker/protocol';
import { PlaylistsService } from '@iptvnator/services';
import {
    Playlist,
    StalkerSessionConnectionOutcome,
    StalkerSessionFullReadyOutcome,
    StalkerSessionStatelessReadyOutcome,
} from '@iptvnator/shared/interfaces';
import { Subject, firstValueFrom, take } from 'rxjs';
import {
    StalkerCredentialsDialogComponent,
    StalkerCredentialsDialogResult,
} from './stalker-credentials-dialog.component';
import { StalkerOriginApprovalDialogComponent } from './stalker-origin-approval-dialog.component';

type ReadyOutcome =
    | StalkerSessionFullReadyOutcome
    | StalkerSessionStatelessReadyOutcome;

interface PendingPersistence {
    readonly announceReady: boolean;
    readonly draft: Playlist;
    readonly outcome: ReadyOutcome;
    readonly runId: number;
}

@Injectable()
export class StalkerConnectionFlowService {
    private readonly destroyRef = inject(DestroyRef);
    private readonly dialog = inject(MatDialog);
    private readonly playlists = inject(PlaylistsService);
    private readonly session = inject(StalkerSessionService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly readySubject = new Subject<Playlist>();
    private activeDialog: { close: () => void } | null = null;
    private activeAttemptRef: string | null = null;
    private pendingPersistence: PendingPersistence | null = null;
    private runId = 0;

    readonly connectionReady$ = this.readySubject.asObservable();

    constructor() {
        const unregister = this.session.registerRecoveryHandler((request) =>
            this.recover(request)
        );
        this.destroyRef.onDestroy(() => {
            unregister();
            void this.cancel();
            this.readySubject.complete();
        });
    }

    async ensureConnected(playlist: Playlist): Promise<Playlist | undefined> {
        if (!this.shouldUseTypedSession(playlist)) {
            return playlist;
        }
        const runId = ++this.runId;
        await this.discardPending();
        const needsMigration = !this.hasVerifiedRecipe(playlist);
        try {
            const outcome = await this.session.open(
                playlist,
                needsMigration
                    ? {
                          connectionMode: 'provisional',
                          provisionalReason: 'migration',
                      }
                    : {}
            );
            return await this.handleOutcome(playlist, outcome, runId, false);
        } catch {
            return undefined;
        }
    }

    async forceRedetect(playlist: Playlist): Promise<Playlist | undefined> {
        if (!this.session.supportsTypedSessions()) {
            return playlist;
        }
        const leaseRef = this.session.getLeaseRef(playlist._id);
        if (leaseRef === undefined) {
            const runId = ++this.runId;
            await this.discardPending();
            try {
                const outcome = await this.session.open(playlist, {
                    connectionMode: 'provisional',
                    provisionalReason: 'migration',
                });
                return this.handleOutcome(playlist, outcome, runId, true);
            } catch {
                return undefined;
            }
        }
        const runId = ++this.runId;
        const outcome = await this.session.forceRedetect(leaseRef);
        return outcome.kind === 'success'
            ? playlist
            : this.handleOutcome(playlist, outcome, runId, true);
    }

    async retryPendingPersistence(): Promise<Playlist | undefined> {
        const pending = this.pendingPersistence;
        if (pending === null || pending.runId !== this.runId) {
            return undefined;
        }
        return this.persistAndCommit({
            ...pending,
            announceReady: true,
        });
    }

    async cancel(): Promise<void> {
        this.runId += 1;
        this.activeDialog?.close();
        this.activeDialog = null;
        await this.discardPending();
    }

    private async recover(
        request: StalkerSessionRecoveryRequest
    ): Promise<boolean> {
        if (!this.shouldUseTypedSession(request.playlist)) {
            return false;
        }
        const runId = ++this.runId;
        await this.discardPending();
        try {
            const outcome =
                request.outcome.kind === 'failure'
                    ? await this.session.open(request.playlist, {
                          connectionMode: 'provisional',
                          provisionalReason: 'migration',
                      })
                    : request.outcome;
            return (
                (await this.handleOutcome(
                    request.playlist,
                    outcome,
                    runId,
                    true
                )) !== undefined
            );
        } catch {
            return false;
        }
    }

    private async handleOutcome(
        playlist: Playlist,
        initialOutcome: StalkerSessionConnectionOutcome,
        runId: number,
        announceReady: boolean
    ): Promise<Playlist | undefined> {
        let outcome = initialOutcome;
        let acceptedCredentials:
            | StalkerCredentialsDialogResult
            | undefined;
        let credentialsInvalidated = false;
        let credentialsSubmitted = false;
        while (true) {
            if (await this.discardOutcomeWhenStale(outcome, runId)) {
                return undefined;
            }
            this.activeAttemptRef =
                this.getOutcomeAttemptRef(outcome) ?? this.activeAttemptRef;
            if (outcome.kind === 'ready') {
                const draft = this.applyReadyOutcome(
                    playlist,
                    outcome,
                    acceptedCredentials,
                    credentialsInvalidated || credentialsSubmitted
                );
                return this.persistAndCommit({
                    announceReady,
                    draft,
                    outcome,
                    runId,
                });
            }
            if (outcome.kind === 'origin-approval-required') {
                acceptedCredentials = undefined;
                credentialsInvalidated = true;
                const approved = await this.requestOriginApproval(outcome);
                if (runId !== this.runId) {
                    return undefined;
                }
                outcome = await this.session.continue(playlist._id, {
                    challengeRef: outcome.challengeRef,
                    response: {
                        approved,
                        kind: 'origin-approval',
                    },
                });
                if (await this.discardOutcomeWhenStale(outcome, runId)) {
                    return undefined;
                }
                if (!approved) {
                    return undefined;
                }
                continue;
            }
            if (outcome.kind === 'credentials-required') {
                acceptedCredentials = undefined;
                const credentials = await this.requestCredentials(
                    playlist,
                    outcome.savedCredentialsRejected === true
                );
                if (runId !== this.runId) {
                    return undefined;
                }
                if (credentials === undefined) {
                    await this.discardPending();
                    return undefined;
                }
                credentialsSubmitted = true;
                outcome = await this.session.continue(playlist._id, {
                    challengeRef: outcome.challengeRef,
                    response: {
                        kind: 'credentials',
                        ...credentials,
                    },
                });
                acceptedCredentials =
                    outcome.kind === 'ready' ? credentials : undefined;
                continue;
            }
            return undefined;
        }
        return undefined;
    }

    private async requestOriginApproval(
        outcome: Extract<
            StalkerSessionConnectionOutcome,
            { kind: 'origin-approval-required' }
        >
    ): Promise<boolean> {
        const ref = this.dialog.open(StalkerOriginApprovalDialogComponent, {
            data: {
                finalOrigin: outcome.finalOrigin,
                sourceOrigin: outcome.sourceOrigin,
            },
            disableClose: true,
        });
        this.activeDialog = ref;
        const approved = await firstValueFrom(ref.afterClosed(), {
            defaultValue: false,
        });
        if (this.activeDialog === ref) {
            this.activeDialog = null;
        }
        return approved === true;
    }

    private async requestCredentials(
        playlist: Playlist,
        savedCredentialsRejected: boolean
    ): Promise<StalkerCredentialsDialogResult | undefined> {
        const ref = this.dialog.open(StalkerCredentialsDialogComponent, {
            data: {
                savedCredentialsRejected,
                username: playlist.username,
            },
            disableClose: true,
        });
        this.activeDialog = ref;
        const credentials = await firstValueFrom(ref.afterClosed(), {
            defaultValue: null,
        });
        if (this.activeDialog === ref) {
            this.activeDialog = null;
        }
        return credentials ?? undefined;
    }

    private async persistAndCommit(
        pending: PendingPersistence
    ): Promise<Playlist | undefined> {
        this.activeAttemptRef = pending.outcome.attemptRef ?? null;
        let persisted: Playlist;
        try {
            persisted = await firstValueFrom(
                this.playlists.persistStalkerConnection(pending.draft)
            );
        } catch {
            if (pending.runId === this.runId) {
                this.pendingPersistence = pending;
                this.offerPersistenceRetry();
            }
            return undefined;
        }
        if (pending.runId !== this.runId) {
            await this.discardAttempt(pending.outcome.attemptRef);
            return undefined;
        }
        this.store.dispatch(
            PlaylistActions.stalkerConnectionPersisted({
                playlist: persisted,
            })
        );
        if (pending.outcome.attemptRef !== undefined) {
            let promotion;
            try {
                promotion = await this.session.commit(
                    pending.outcome.attemptRef
                );
            } catch {
                return this.reopenPersistedAfterPromotionFailure(
                    pending,
                    persisted
                );
            }
            if (promotion.kind !== 'success') {
                return this.reopenPersistedAfterPromotionFailure(
                    pending,
                    persisted
                );
            }
        }
        if (pending.runId !== this.runId) {
            await this.closeCommittedLease(pending.outcome);
            return undefined;
        }
        this.activeAttemptRef = null;
        this.pendingPersistence = null;
        if (pending.announceReady) {
            this.readySubject.next(persisted);
        }
        return persisted;
    }

    private async reopenPersistedAfterPromotionFailure(
        pending: PendingPersistence,
        persisted: Playlist
    ): Promise<Playlist | undefined> {
        await this.discardAttempt(pending.outcome.attemptRef);
        this.activeAttemptRef = null;
        this.pendingPersistence = null;
        if (pending.runId !== this.runId) {
            return undefined;
        }

        let outcome: StalkerSessionConnectionOutcome;
        try {
            outcome = await this.session.open(persisted);
        } catch {
            this.notifyPromotionFailure();
            return undefined;
        }
        if (await this.discardOutcomeWhenStale(outcome, pending.runId)) {
            return undefined;
        }
        if (outcome.kind !== 'ready') {
            const recovered = await this.handleOutcome(
                persisted,
                outcome,
                pending.runId,
                pending.announceReady
            );
            if (recovered === undefined && pending.runId === this.runId) {
                this.notifyPromotionFailure();
            }
            return recovered;
        }

        if (pending.announceReady) {
            this.readySubject.next(persisted);
        }
        return persisted;
    }

    private async discardOutcomeWhenStale(
        outcome: StalkerSessionConnectionOutcome,
        runId: number
    ): Promise<boolean> {
        if (runId === this.runId) {
            return false;
        }
        await this.discardAttempt(this.getOutcomeAttemptRef(outcome));
        return true;
    }

    private getOutcomeAttemptRef(
        outcome: StalkerSessionConnectionOutcome
    ): string | undefined {
        return 'attemptRef' in outcome ? outcome.attemptRef : undefined;
    }

    private applyReadyOutcome(
        playlist: Playlist,
        outcome: ReadyOutcome,
        acceptedCredentials: StalkerCredentialsDialogResult | undefined,
        clearUnacceptedCredentials: boolean
    ): Playlist {
        const draft: Playlist = {
            ...playlist,
            ...outcome.persistenceDraft,
            portalUrl: outcome.persistenceDraft.portalUrl,
            ...(acceptedCredentials === undefined
                ? {}
                : acceptedCredentials),
        };
        if (
            outcome.recipe === 'stateless-mac' ||
            (clearUnacceptedCredentials && acceptedCredentials === undefined)
        ) {
            delete draft.username;
            delete draft.password;
        }
        delete draft.stalkerToken;
        return draft;
    }

    private async closeCommittedLease(outcome: ReadyOutcome): Promise<void> {
        if (outcome.recipe === 'full-session') {
            await this.session.close(outcome.leaseRef).catch(() => undefined);
        }
    }

    private offerPersistenceRetry(): void {
        const ref = this.snackBar.open(
            this.translate.instant(
                'HOME.STALKER_PORTAL.CONNECTION_FAILURE_GENERIC',
                { reason: 'local-persistence-failed' }
            ),
            this.translate.instant('HOME.STALKER_PORTAL.SAVE_AGAIN'),
            { duration: 120_000 }
        );
        ref.onAction()
            .pipe(take(1))
            .subscribe(() => void this.retryPendingPersistence());
    }

    private notifyPromotionFailure(): void {
        this.snackBar.open(
            this.translate.instant(
                'HOME.STALKER_PORTAL.CONNECTION_FAILURE_GENERIC',
                { reason: 'session-promotion-failed' }
            ),
            undefined,
            { duration: 10_000 }
        );
    }

    private async discardPending(): Promise<void> {
        const attemptRef =
            this.pendingPersistence?.outcome.attemptRef ??
            this.activeAttemptRef ??
            undefined;
        this.pendingPersistence = null;
        this.activeAttemptRef = null;
        await this.discardAttempt(attemptRef);
    }

    private async discardAttempt(
        attemptRef: string | undefined
    ): Promise<void> {
        if (attemptRef !== undefined) {
            await this.session.discard(attemptRef).catch(() => undefined);
        }
    }

    private shouldUseTypedSession(playlist: Playlist): boolean {
        return (
            this.session.supportsTypedSessions() &&
            !(
                playlist.stalkerRequestRecipe === 'stateless-mac' &&
                playlist.stalkerRecipeClassifierVersion ===
                    STALKER_RECIPE_CLASSIFIER_VERSION
            )
        );
    }

    private hasVerifiedRecipe(playlist: Playlist): boolean {
        return (
            playlist.stalkerRequestRecipe === 'full-session' &&
            playlist.stalkerRecipeClassifierVersion ===
                STALKER_RECIPE_CLASSIFIER_VERSION
        );
    }
}
