import { signal } from '@angular/core';
import type { RecordingFeedback } from './embedded-mpv-controls-recording-feedback';

const RECORDING_ACK_TIMEOUT_MS = 5000;
const RECORDING_MESSAGE_DISMISS_DELAY_MS = 5000;

export class EmbeddedMpvControlsRecordingTimers {
    private readonly feedbackState = signal<RecordingFeedback | null>(null);
    readonly feedback = this.feedbackState.asReadonly();

    private acknowledgementTimer: number | null = null;
    private messageTimer: number | null = null;
    private destroyed = false;

    setFeedback(feedback: RecordingFeedback | null, autoDismiss = false): void {
        if (this.destroyed) {
            return;
        }
        this.clearMessage();
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

    scheduleAcknowledgement(callback: () => void): void {
        this.clearAcknowledgement();
        this.acknowledgementTimer = window.setTimeout(() => {
            this.acknowledgementTimer = null;
            callback();
        }, RECORDING_ACK_TIMEOUT_MS);
    }

    clearAcknowledgement(): void {
        if (this.acknowledgementTimer === null) {
            return;
        }
        window.clearTimeout(this.acknowledgementTimer);
        this.acknowledgementTimer = null;
    }

    destroy(): void {
        this.destroyed = true;
        this.clearAcknowledgement();
        this.clearMessage();
        this.feedbackState.set(null);
    }

    private clearMessage(): void {
        if (this.messageTimer === null) {
            return;
        }
        window.clearTimeout(this.messageTimer);
        this.messageTimer = null;
    }
}
