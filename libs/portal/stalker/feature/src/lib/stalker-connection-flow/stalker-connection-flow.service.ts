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
    readonly clearCredentials: boolean;
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
    private activeConnectionRetry: { dismiss: () => void } | null = null;
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
        const runId = ++this.runId;
        this.dismissConnectionRetry();
        if (!this.shouldUseTypedSession(playlist)) {
            return playlist;
        }
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
            this.offerConnectionRetry(
                playlist,
                'connection-open-failed',
                runId
            );
            return undefined;
        }
    }

    async forceRedetect(playlist: Playlist): Promise<Playlist | undefined> {
        if (!this.session.supportsTypedSessions()) {
            this.dismissConnectionRetry();
            return playlist;
        }
        const leaseRef = this.session.getLeaseRef(playlist._id);
        const runId = ++this.runId;
        this.dismissConnectionRetry();
        try {
            if (leaseRef === undefined) {
                await this.discardPending();
                const outcome = await this.session.open(playlist, {
                    connectionMode: 'provisional',
                    provisionalReason: 'migration',
                });
                return await this.handleOutcome(
                    playlist,
                    outcome,
                    runId,
                    true
                );
            }
            const outcome = await this.session.forceRedetect(leaseRef);
            return outcome.kind === 'success'
                ? playlist
                : await this.handleOutcome(playlist, outcome, runId, true);
        } catch {
            this.offerConnectionRetry(
                playlist,
                'connection-redetect-failed',
                runId
            );
            return undefined;
        }
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
        this.dismissConnectionRetry();
        this.activeDialog?.close();
        this.activeDialog = null;
        await this.discardPending();
    }

    private async recover(
        request: StalkerSessionRecoveryRequest
    ): Promise<Playlist | undefined> {
        if (
            !this.session.supportsTypedSessions() ||
            (request.trigger !== 'endpoint-shape' &&
                !this.shouldUseTypedSession(request.playlist))
        ) {
            return undefined;
        }
        const runId = ++this.runId;
        this.dismissConnectionRetry();
        await this.discardPending();
        try {
            const outcome =
                request.trigger === 'endpoint-shape' ||
                request.outcome.kind === 'failure'
                    ? await this.session.open(request.playlist, {
                          connectionMode: 'provisional',
                          provisionalReason: 'migration',
                      })
                    : request.outcome;
            return await this.handleOutcome(
                request.playlist,
                outcome,
                runId,
                true
            );
        } catch {
            this.offerConnectionRetry(
                request.playlist,
                'connection-recovery-failed',
                runId
            );
            return undefined;
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
                const clearCredentials =
                    outcome.recipe === 'stateless-mac' ||
                    ((credentialsInvalidated || credentialsSubmitted) &&
                        acceptedCredentials === undefined);
                const draft = this.applyReadyOutcome(
                    playlist,
                    outcome,
                    acceptedCredentials,
                    clearCredentials
                );
                return this.persistAndCommit({
                    announceReady,
                    clearCredentials,
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
            if (outcome.kind === 'failure') {
                this.offerConnectionRetry(playlist, outcome.reason, runId);
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
            const persistence = pending.clearCredentials
                ? this.playlists.persistStalkerConnection(pending.draft, {
                      clearCredentials: true,
                  })
                : this.playlists.persistStalkerConnection(pending.draft);
            persisted = await firstValueFrom(
                persistence
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
        this.dismissConnectionRetry();
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
            this.offerConnectionRetry(
                persisted,
                'session-promotion-failed',
                pending.runId
            );
            return undefined;
        }
        if (await this.discardOutcomeWhenStale(outcome, pending.runId)) {
            return undefined;
        }
        if (outcome.kind !== 'ready') {
            return this.handleOutcome(
                persisted,
                outcome,
                pending.runId,
                pending.announceReady
            );
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
        clearCredentials: boolean
    ): Playlist {
        const draft: Playlist = {
            ...playlist,
            ...outcome.persistenceDraft,
            portalUrl: outcome.persistenceDraft.portalUrl,
            ...(acceptedCredentials === undefined
                ? {}
                : acceptedCredentials),
        };
        if (clearCredentials) {
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
        this.dismissConnectionRetry();
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

    offerRetry(playlist: Playlist, reason: string): void {
        this.offerConnectionRetry(playlist, reason, this.runId);
    }

    private offerConnectionRetry(
        playlist: Playlist,
        reason: string,
        runId: number
    ): void {
        if (runId !== this.runId) {
            return;
        }
        this.dismissConnectionRetry();
        const ref = this.snackBar.open(
            this.connectionFailureMessage(reason),
            this.translate.instant('HOME.STALKER_PORTAL.RETRY'),
            { duration: 120_000 }
        );
        this.activeConnectionRetry = ref;
        ref.onAction()
            .pipe(take(1))
            .subscribe(() => {
                if (
                    runId !== this.runId ||
                    this.activeConnectionRetry !== ref
                ) {
                    return;
                }
                this.activeConnectionRetry = null;
                void this.forceRedetect(playlist);
            });
    }

    private connectionFailureMessage(reason: string): string {
        const message = this.translate.instant(
            'HOME.STALKER_PORTAL.CONNECTION_FAILURE_GENERIC',
            { reason }
        );
        return message.includes(reason) ? message : `${message} ${reason}`;
    }

    private dismissConnectionRetry(): void {
        this.activeConnectionRetry?.dismiss();
        this.activeConnectionRetry = null;
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
