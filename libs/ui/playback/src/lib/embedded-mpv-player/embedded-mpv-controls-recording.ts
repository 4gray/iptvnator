import type {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    RECORDING_FEEDBACK,
    RECORDING_TRANSLATION,
    type RecordingFeedback,
} from './embedded-mpv-controls-recording-feedback';
import { EmbeddedMpvControlsRecordingTimers } from './embedded-mpv-controls-recording-timers';
import type { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const RECORDING_OPERATION = {
    START: 'start',
    STOP: 'stop',
} as const;

type RecordingOperation =
    (typeof RECORDING_OPERATION)[keyof typeof RECORDING_OPERATION];

interface RecordingOutcome {
    readonly feedback: RecordingFeedback | null;
    readonly autoDismiss?: boolean;
    readonly expectedActive?: boolean;
}

interface PendingRecordingOperation {
    readonly generation: number;
    readonly kind: RecordingOperation;
    readonly playbackIdentity: string;
    readonly sessionId: string;
    readonly expectedActive: boolean;
    readonly initialError: string | null;
    readonly targetPath: string | null;
    readonly baselineSnapshotIdentity: string | null;
    observedOutcome: RecordingOutcome | null;
    timeoutFeedback: RecordingFeedback | null;
    commandSettled: boolean;
    sawErrorClear: boolean;
}

export interface RecordingToggleContext {
    readonly folder: string;
    readonly playback: ResolvedPortalPlayback;
    readonly playbackIdentity: string;
    readonly session: EmbeddedMpvSession;
}

export class EmbeddedMpvControlsRecording {
    private readonly timers = new EmbeddedMpvControlsRecordingTimers();
    readonly feedback = this.timers.feedback;

    private pending: PendingRecordingOperation | null = null;
    private operationGeneration = 0;
    private ownerIdentity: string | null | undefined;
    private destroyed = false;

    constructor(
        private readonly controller: EmbeddedMpvSessionController,
        private readonly currentPlaybackIdentity: () => string | null
    ) {}

    toggle(context: RecordingToggleContext): void {
        if (this.destroyed || this.pending) {
            return;
        }
        const recording = context.session.recording;
        const initialError = this.recordingError(context.session);
        const kind = recording?.active
            ? RECORDING_OPERATION.STOP
            : RECORDING_OPERATION.START;
        const generation = ++this.operationGeneration;
        this.pending = {
            generation,
            kind,
            playbackIdentity: context.playbackIdentity,
            sessionId: context.session.id,
            expectedActive: kind === RECORDING_OPERATION.START,
            initialError,
            targetPath: recording?.targetPath ?? null,
            baselineSnapshotIdentity: this.recordingSnapshotIdentity(
                context.session
            ),
            observedOutcome: null,
            timeoutFeedback: null,
            commandSettled: false,
            sawErrorClear: initialError === null,
        };
        this.setFeedback(null);
        this.timers.scheduleAcknowledgement(() =>
            this.handleAcknowledgementTimeout(generation)
        );
        const command =
            kind === RECORDING_OPERATION.START
                ? this.controller.startRecording(
                      context.folder,
                      context.playback.title
                  )
                : this.controller.stopRecording();
        void command.then(
            () => this.markCommandSettled(generation),
            () => this.markCommandSettled(generation)
        );
    }

    reconcile(
        session: EmbeddedMpvSession | null,
        playbackIdentity: string | null
    ): void {
        const pending = this.pending;
        if (!pending) {
            return;
        }
        if (
            !session ||
            session.id !== pending.sessionId ||
            playbackIdentity !== pending.playbackIdentity
        ) {
            this.cancelPending();
            this.setFeedback(null);
            return;
        }
        const observedOutcome = pending.observedOutcome;
        if (
            pending.commandSettled &&
            observedOutcome?.expectedActive !== undefined &&
            !this.recordingError(session) &&
            session.recording?.active === observedOutcome.expectedActive
        ) {
            this.completePending(
                observedOutcome.feedback,
                observedOutcome.autoDismiss
            );
            return;
        }
        if (
            this.recordingSnapshotIdentity(session) ===
            pending.baselineSnapshotIdentity
        ) {
            return;
        }
        const recording = session.recording;
        if (!recording) {
            return;
        }
        const error = this.recordingError(session);
        if (error) {
            if (pending.sawErrorClear || error !== pending.initialError) {
                this.observeOutcome(pending, {
                    feedback: {
                        kind: RECORDING_FEEDBACK.RAW,
                        text: error,
                    },
                });
            }
            return;
        }
        pending.sawErrorClear = true;
        if (recording.active !== pending.expectedActive) {
            return;
        }
        if (pending.kind === RECORDING_OPERATION.START) {
            this.observeOutcome(pending, {
                feedback: null,
                expectedActive: pending.expectedActive,
            });
            return;
        }
        const targetPath = recording.targetPath ?? pending.targetPath;
        this.observeOutcome(pending, {
            feedback: targetPath
                ? {
                      kind: RECORDING_FEEDBACK.TRANSLATED,
                      key: RECORDING_TRANSLATION.SAVED_TO,
                      params: { path: targetPath },
                  }
                : null,
            autoDismiss: Boolean(targetPath),
            expectedActive: pending.expectedActive,
        });
    }

    syncOwner(playbackIdentity: string | null, sessionId: string | null): void {
        const nextIdentity =
            playbackIdentity === null
                ? null
                : JSON.stringify([playbackIdentity, sessionId]);
        if (this.ownerIdentity === undefined) {
            this.ownerIdentity = nextIdentity;
            return;
        }
        if (this.ownerIdentity === nextIdentity) {
            return;
        }
        this.ownerIdentity = nextIdentity;
        this.setFeedback(null);
        if (
            this.pending &&
            (this.pending.playbackIdentity !== playbackIdentity ||
                this.pending.sessionId !== sessionId)
        ) {
            this.cancelPending();
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelPending();
        this.timers.destroy();
    }

    private handleAcknowledgementTimeout(generation: number): void {
        let pending = this.pending;
        if (!pending || pending.generation !== generation) {
            return;
        }
        this.reconcile(
            this.controller.session(),
            this.currentPlaybackIdentity()
        );
        pending = this.pending;
        if (
            !pending ||
            pending.generation !== generation ||
            (pending.observedOutcome && !pending.commandSettled)
        ) {
            return;
        }
        const currentSession = this.controller.session();
        const currentOwnerIdentity = JSON.stringify([
            pending.playbackIdentity,
            pending.sessionId,
        ]);
        const error =
            currentSession?.id === pending.sessionId &&
            this.ownerIdentity === currentOwnerIdentity
                ? this.recordingError(currentSession)
                : null;
        const feedback: RecordingFeedback = {
            ...(error
                ? { kind: RECORDING_FEEDBACK.RAW, text: error }
                : {
                      kind: RECORDING_FEEDBACK.TRANSLATED,
                      key:
                          pending.kind === RECORDING_OPERATION.START
                              ? RECORDING_TRANSLATION.START_FAILED
                              : RECORDING_TRANSLATION.STOP_FAILED,
                  }),
        };
        pending.timeoutFeedback = feedback;
        if (pending.commandSettled) {
            this.completePending(feedback);
            return;
        }
        this.setFeedback(feedback);
    }

    private markCommandSettled(generation: number): void {
        const pending = this.pending;
        if (!pending || pending.generation !== generation) {
            return;
        }
        pending.commandSettled = true;
        this.reconcile(
            this.controller.session(),
            this.currentPlaybackIdentity()
        );
        const reconciledPending = this.pending;
        if (!reconciledPending || reconciledPending.generation !== generation) {
            return;
        }
        const outcome = reconciledPending.observedOutcome;
        if (outcome && outcome.expectedActive === undefined) {
            this.completePending(outcome.feedback, outcome.autoDismiss);
            return;
        }
        if (outcome) {
            this.setFeedback(outcome.feedback);
            this.timers.scheduleAcknowledgement(() =>
                this.handleAcknowledgementTimeout(generation)
            );
            return;
        }
        if (reconciledPending.timeoutFeedback) {
            this.completePending(reconciledPending.timeoutFeedback);
        }
    }

    private observeOutcome(
        pending: PendingRecordingOperation,
        outcome: RecordingOutcome
    ): void {
        if (this.pending !== pending || pending.observedOutcome) {
            return;
        }
        pending.observedOutcome = outcome;
        this.timers.clearAcknowledgement();
        if (pending.commandSettled) {
            this.completePending(outcome.feedback, outcome.autoDismiss);
        } else if (
            pending.timeoutFeedback ||
            outcome.feedback?.kind === RECORDING_FEEDBACK.RAW
        ) {
            this.setFeedback(outcome.feedback, outcome.autoDismiss);
        }
    }

    private recordingSnapshotIdentity(
        session: EmbeddedMpvSession | null
    ): string | null {
        if (!session) {
            return null;
        }
        const recording = session.recording;
        return JSON.stringify([
            session.id,
            recording?.active ?? false,
            recording?.targetPath ?? null,
            recording?.startedAt ?? null,
            recording?.error ?? null,
        ]);
    }

    private recordingError(session: EmbeddedMpvSession): string | null {
        const error = session.recording?.error;
        return error?.trim() ? error : null;
    }

    private completePending(
        feedback: RecordingFeedback | null,
        autoDismiss = false
    ): void {
        this.timers.clearAcknowledgement();
        this.pending = null;
        this.setFeedback(feedback, autoDismiss);
    }

    private cancelPending(): void {
        this.operationGeneration += 1;
        this.pending = null;
        this.timers.clearAcknowledgement();
    }

    private setFeedback(
        feedback: RecordingFeedback | null,
        autoDismiss = false
    ): void {
        this.timers.setFeedback(feedback, autoDismiss);
    }
}
