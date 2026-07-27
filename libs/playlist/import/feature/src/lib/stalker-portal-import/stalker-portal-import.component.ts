/* eslint-disable max-lines -- the challenge-driven import state machine is kept in one lifecycle owner */
import {
    Component,
    OnDestroy,
    computed,
    inject,
    output,
    signal,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { PlaylistsService } from '@iptvnator/services';
import type {
    Playlist,
    StalkerSessionAttemptRef,
    StalkerSessionChallengeRef,
    StalkerSessionConnectionOutcome,
    StalkerSessionFailureReason,
} from '@iptvnator/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { v4 as uuid } from 'uuid';
import { createStalkerImportForm } from './stalker-import-form';
import {
    applyStalkerReadyOutcome,
    buildProvisionalStalkerPlaylist,
    isStalkerReadyOutcome,
    readStalkerCredentialCandidate,
    type StalkerAcceptedCredentials,
    type StalkerImportReadyOutcome,
} from './stalker-import-playlist';

export type StalkerImportConnectionStage =
    | 'idle'
    | 'resolving'
    | 'awaiting-origin-approval'
    | 'credentials-required'
    | 'validating-credentials'
    | 'saving'
    | 'persistence-failed'
    | 'connected'
    | 'failure';

interface PendingOriginApproval {
    readonly sourceOrigin: string;
    readonly finalOrigin: string;
}

interface PendingReady {
    readonly outcome: StalkerImportReadyOutcome;
    readonly playlist: Playlist;
}

@Component({
    imports: [
        FormsModule,
        MatButtonModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        ReactiveFormsModule,
        TranslatePipe,
    ],
    selector: 'app-stalker-portal-import',
    templateUrl: './stalker-portal-import.component.html',
    styleUrl: './stalker-portal-import.component.scss',
})
export class StalkerPortalImportComponent implements OnDestroy {
    readonly addClicked = output<void>();
    readonly form = createStalkerImportForm();

    private readonly session = inject(StalkerSessionService);
    private readonly playlists = inject(PlaylistsService);
    private readonly store = inject(Store);
    private readonly snackBar = inject(MatSnackBar);
    readonly translate = inject(TranslateService);

    readonly connectionStage = signal<StalkerImportConnectionStage>('idle');
    readonly failureReason = signal<StalkerSessionFailureReason | null>(null);
    readonly pendingOriginApproval = signal<PendingOriginApproval | null>(null);
    readonly credentialsRequested = signal(false);
    readonly savedCredentialsRejected = signal(false);
    readonly passwordVisible = signal(false);
    readonly advancedVisible = signal(false);
    readonly isLoading = computed(() =>
        (
            [
                'resolving',
                'validating-credentials',
                'saving',
            ] as StalkerImportConnectionStage[]
        ).includes(this.connectionStage())
    );

    private runId = 0;
    private provisionalPlaylist: Playlist | null = null;
    private pendingAttemptRef: StalkerSessionAttemptRef | null = null;
    private pendingChallengeRef: StalkerSessionChallengeRef | null = null;
    private pendingReady: PendingReady | null = null;
    private acceptedCredentials: StalkerAcceptedCredentials | undefined;
    private credentialCandidate: StalkerAcceptedCredentials | undefined;
    private automaticCredentialsTried = false;
    private committed = false;

    clearForm(): void {
        this.runId += 1;
        void this.discardPendingAttempt();
        this.resetConnectionState();
        this.form.reset({
            _id: uuid(),
            title: '',
            macAddress: '',
            serialNumber: '',
            deviceId1: '',
            deviceId2: '',
            signature1: '',
            signature2: '',
            password: '',
            username: '',
            portalUrl: '',
            importDate: new Date().toISOString(),
            userAgent: '',
        });
    }

    ngOnDestroy(): void {
        this.runId += 1;
        void this.discardPendingAttempt();
    }

    async addPlaylist(): Promise<void> {
        if (!this.form.valid || this.isLoading()) {
            return;
        }

        const runId = ++this.runId;
        await this.discardPendingAttempt();
        this.resetConnectionState();
        this.connectionStage.set('resolving');

        try {
            this.provisionalPlaylist = buildProvisionalStalkerPlaylist(
                this.form.getRawValue()
            );
            this.credentialCandidate = readStalkerCredentialCandidate(
                this.form.getRawValue()
            );
            const outcome = await this.session.open(this.provisionalPlaylist, {
                connectionMode: 'provisional',
                provisionalReason: 'import',
            });
            if (runId !== this.runId) {
                await this.discardStaleOutcome(outcome);
                return;
            }
            await this.handleOutcome(outcome, runId);
        } catch {
            if (runId === this.runId) {
                this.fail('portal-unavailable');
            }
        }
    }

    async respondToOriginApproval(approved: boolean): Promise<void> {
        const challengeRef = this.pendingChallengeRef;
        const playlistRef = this.provisionalPlaylist?._id;
        if (!challengeRef || !playlistRef || this.isLoading()) {
            return;
        }

        const runId = this.runId;
        this.connectionStage.set('resolving');
        this.pendingOriginApproval.set(null);
        this.pendingChallengeRef = null;
        try {
            const outcome = await this.session.continue(playlistRef, {
                challengeRef,
                response: {
                    approved,
                    kind: 'origin-approval',
                },
            });
            if (runId === this.runId) {
                await this.handleOutcome(outcome, runId);
            } else {
                await this.discardStaleOutcome(outcome);
            }
        } catch {
            if (runId === this.runId) {
                this.fail('origin-not-approved');
            }
        }
    }

    async submitCredentials(): Promise<void> {
        const credentials = readStalkerCredentialCandidate(
            this.form.getRawValue()
        );
        if (credentials === undefined) {
            return;
        }
        await this.continueWithCredentials(credentials);
    }

    async saveAgain(): Promise<void> {
        if (
            this.connectionStage() !== 'persistence-failed' ||
            this.pendingReady === null
        ) {
            return;
        }
        await this.persistAndCommit(this.pendingReady, this.runId);
    }

    togglePasswordVisibility(): void {
        this.passwordVisible.update((visible) => !visible);
    }

    private async continueWithCredentials(
        credentials: StalkerAcceptedCredentials
    ): Promise<void> {
        const challengeRef = this.pendingChallengeRef;
        const playlistRef = this.provisionalPlaylist?._id;
        if (!challengeRef || !playlistRef || this.isLoading()) {
            return;
        }

        const runId = this.runId;
        this.credentialCandidate = credentials;
        this.acceptedCredentials = undefined;
        this.automaticCredentialsTried = true;
        this.pendingChallengeRef = null;
        this.connectionStage.set('validating-credentials');
        try {
            const outcome = await this.session.continue(playlistRef, {
                challengeRef,
                response: {
                    kind: 'credentials',
                    ...credentials,
                },
            });
            if (runId === this.runId) {
                this.acceptedCredentials =
                    isStalkerReadyOutcome(outcome) &&
                    outcome.recipe === 'full-session'
                        ? credentials
                        : undefined;
                await this.handleOutcome(outcome, runId);
            } else {
                await this.discardStaleOutcome(outcome);
            }
        } catch {
            if (runId === this.runId) {
                this.fail('portal-unavailable');
            }
        }
    }

    private async handleOutcome(
        outcome: StalkerSessionConnectionOutcome,
        runId: number
    ): Promise<void> {
        if (isStalkerReadyOutcome(outcome)) {
            const provisional = this.provisionalPlaylist;
            if (provisional === null) {
                this.fail('local-persistence-failed');
                return;
            }
            const playlist = applyStalkerReadyOutcome(
                provisional,
                outcome,
                this.acceptedCredentials
            );
            const pending = { outcome, playlist };
            this.pendingAttemptRef = outcome.attemptRef ?? null;
            this.pendingReady = pending;
            await this.persistAndCommit(pending, runId);
            return;
        }

        if (outcome.kind === 'origin-approval-required') {
            this.acceptedCredentials = undefined;
            this.credentialCandidate = undefined;
            this.pendingAttemptRef = outcome.attemptRef;
            this.pendingChallengeRef = outcome.challengeRef;
            this.pendingOriginApproval.set({
                finalOrigin: outcome.finalOrigin,
                sourceOrigin: outcome.sourceOrigin,
            });
            this.connectionStage.set('awaiting-origin-approval');
            return;
        }

        if (outcome.kind === 'credentials-required') {
            this.acceptedCredentials = undefined;
            this.pendingAttemptRef = outcome.attemptRef;
            this.pendingChallengeRef = outcome.challengeRef;
            this.credentialsRequested.set(true);
            this.savedCredentialsRejected.set(
                outcome.savedCredentialsRejected === true
            );
            const candidate = this.credentialCandidate;
            this.credentialCandidate = undefined;
            if (candidate !== undefined && !this.automaticCredentialsTried) {
                this.automaticCredentialsTried = true;
                await this.continueWithCredentials(candidate);
                return;
            }
            this.connectionStage.set('credentials-required');
            return;
        }

        this.fail(outcome.reason);
    }

    private async persistAndCommit(
        pending: PendingReady,
        runId: number
    ): Promise<void> {
        this.connectionStage.set('saving');
        this.failureReason.set(null);
        let persisted: Playlist;
        try {
            persisted = await firstValueFrom(
                this.playlists.persistStalkerConnection(pending.playlist)
            );
        } catch {
            if (runId === this.runId) {
                this.connectionStage.set('persistence-failed');
                this.failureReason.set('local-persistence-failed');
                this.notifyFailure('local-persistence-failed');
            }
            return;
        }
        if (runId !== this.runId) {
            return;
        }
        this.store.dispatch(
            PlaylistActions.stalkerConnectionPersisted({
                playlist: persisted,
            })
        );

        const attemptRef = pending.outcome.attemptRef;
        if (attemptRef === undefined) {
            await this.discardPendingAttempt();
            this.fail('session-promotion-failed');
            return;
        }
        try {
            const promotion = await this.session.commit(attemptRef);
            if (promotion.kind !== 'success') {
                await this.failPromotion(runId);
                return;
            }
        } catch {
            await this.failPromotion(runId);
            return;
        }
        if (runId !== this.runId) {
            await this.closeCommittedLease(pending.outcome);
            return;
        }

        this.committed = true;
        this.pendingAttemptRef = null;
        this.pendingReady = null;
        this.connectionStage.set('connected');
        this.addClicked.emit();
    }

    private async failPromotion(runId: number): Promise<void> {
        await this.discardPendingAttempt();
        if (runId === this.runId) {
            this.fail('session-promotion-failed');
        }
    }

    private async closeCommittedLease(
        outcome: StalkerImportReadyOutcome
    ): Promise<void> {
        if (outcome.recipe === 'full-session') {
            await this.session.close(outcome.leaseRef).catch(() => undefined);
        }
    }

    private async discardPendingAttempt(): Promise<void> {
        const attemptRef =
            this.pendingReady?.outcome.attemptRef ??
            this.pendingAttemptRef ??
            undefined;
        this.pendingAttemptRef = null;
        this.pendingReady = null;
        if (attemptRef !== undefined && !this.committed) {
            await this.session.discard(attemptRef).catch(() => undefined);
        }
    }

    private async discardStaleOutcome(
        outcome: StalkerSessionConnectionOutcome
    ): Promise<void> {
        const attemptRef =
            'attemptRef' in outcome ? outcome.attemptRef : undefined;
        if (attemptRef !== undefined) {
            await this.session.discard(attemptRef).catch(() => undefined);
        }
    }

    private fail(reason: StalkerSessionFailureReason): void {
        this.acceptedCredentials = undefined;
        this.credentialCandidate = undefined;
        this.failureReason.set(reason);
        this.connectionStage.set('failure');
        this.notifyFailure(reason);
    }

    private notifyFailure(reason: StalkerSessionFailureReason): void {
        this.snackBar.open(
            this.translate.instant(
                'HOME.STALKER_PORTAL.CONNECTION_FAILURE_GENERIC',
                { reason }
            ),
            undefined,
            { duration: 5000 }
        );
    }

    private resetConnectionState(): void {
        this.provisionalPlaylist = null;
        this.pendingAttemptRef = null;
        this.pendingChallengeRef = null;
        this.pendingReady = null;
        this.acceptedCredentials = undefined;
        this.credentialCandidate = undefined;
        this.automaticCredentialsTried = false;
        this.committed = false;
        this.failureReason.set(null);
        this.pendingOriginApproval.set(null);
        this.credentialsRequested.set(false);
        this.savedCredentialsRejected.set(false);
        this.passwordVisible.set(false);
        this.connectionStage.set('idle');
    }
}
