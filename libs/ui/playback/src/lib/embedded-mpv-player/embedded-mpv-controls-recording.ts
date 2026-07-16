import { signal } from '@angular/core';
import type {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { TranslateService } from '@ngx-translate/core';
import type { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

const RECORDING_ACK_TIMEOUT_MS = 5000;
const RECORDING_MESSAGE_DISMISS_DELAY_MS = 5000;

const RECORDING_OPERATION = {
    START: 'start',
    STOP: 'stop',
} as const;

const RECORDING_FEEDBACK = {
    RAW: 'raw',
    TRANSLATED: 'translated',
} as const;

const RECORDING_TRANSLATION = {
    START_FAILED: 'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_START',
    STOP_FAILED: 'EMBEDDED_MPV.PLAYER.RECORDING_FAILED_TO_STOP',
    SAVED_TO: 'EMBEDDED_MPV.PLAYER.SAVED_TO',
} as const;

type RecordingOperation =
    (typeof RECORDING_OPERATION)[keyof typeof RECORDING_OPERATION];
type RecordingTranslationKey =
    (typeof RECORDING_TRANSLATION)[keyof typeof RECORDING_TRANSLATION];

interface RawRecordingFeedback {
    readonly kind: typeof RECORDING_FEEDBACK.RAW;
    readonly text: string;
}

interface TranslatedRecordingFeedback {
    readonly kind: typeof RECORDING_FEEDBACK.TRANSLATED;
    readonly key: RecordingTranslationKey;
    readonly params?: Readonly<Record<string, string>>;
}

export type RecordingFeedback =
    | RawRecordingFeedback
    | TranslatedRecordingFeedback;

interface RecordingOutcome {
    readonly feedback: RecordingFeedback | null;
    readonly autoDismiss?: boolean;
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
    private readonly feedbackState = signal<RecordingFeedback | null>(null);
    readonly feedback = this.feedbackState.asReadonly();

    private pending: PendingRecordingOperation | null = null;
    private operationGeneration = 0;
    private acknowledgementTimer: number | null = null;
    private messageTimer: number | null = null;
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
        this.acknowledgementTimer = window.setTimeout(
            () => this.handleAcknowledgementTimeout(generation),
            RECORDING_ACK_TIMEOUT_MS
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
            this.observeOutcome(pending, { feedback: null });
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
        this.setFeedback(null);
        this.destroyed = true;
        this.cancelPending();
    }

    private handleAcknowledgementTimeout(generation: number): void {
        let pending = this.pending;
        if (!pending || pending.generation !== generation) {
            return;
        }
        this.acknowledgementTimer = null;
        this.reconcile(
            this.controller.session(),
            this.currentPlaybackIdentity()
        );
        pending = this.pending;
        if (
            !pending ||
            pending.generation !== generation ||
            pending.observedOutcome
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
        if (reconciledPending.observedOutcome) {
            this.completePending(
                reconciledPending.observedOutcome.feedback,
                reconciledPending.observedOutcome.autoDismiss
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
        this.clearAcknowledgementTimer();
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
        this.clearAcknowledgementTimer();
        this.pending = null;
        this.setFeedback(feedback, autoDismiss);
    }

    private cancelPending(): void {
        this.operationGeneration += 1;
        this.pending = null;
        this.clearAcknowledgementTimer();
    }

    private setFeedback(
        feedback: RecordingFeedback | null,
        autoDismiss = false
    ): void {
        if (this.destroyed) {
            return;
        }
        this.clearMessageTimer();
        this.feedbackState.set(feedback);
        if (!feedback || !autoDismiss) {
            return;
        }
        const timerId = window.setTimeout(() => {
            if (!this.destroyed && this.feedbackState() === feedback) {
                this.feedbackState.set(null);
            }
            if (this.messageTimer === timerId) {
                this.messageTimer = null;
            }
        }, RECORDING_MESSAGE_DISMISS_DELAY_MS);
        this.messageTimer = timerId;
    }

    private clearAcknowledgementTimer(): void {
        if (this.acknowledgementTimer !== null) {
            window.clearTimeout(this.acknowledgementTimer);
            this.acknowledgementTimer = null;
        }
    }

    private clearMessageTimer(): void {
        if (this.messageTimer !== null) {
            window.clearTimeout(this.messageTimer);
            this.messageTimer = null;
        }
    }
}
export function resolveRecordingFeedback(
    feedback: RecordingFeedback | null,
    translate: TranslateService
): string | null {
    if (!feedback) {
        return null;
    }
    return feedback.kind === RECORDING_FEEDBACK.RAW
        ? feedback.text
        : translate.instant(feedback.key, feedback.params);
}
