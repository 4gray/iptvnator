import { signal } from '@angular/core';
import type { PlayerRecordingState } from './player-controls.model';

export interface RecordingFeedbackLabels {
    active: string;
    inactive: string;
}

/**
 * Transient feedback overlay shown when the user adjusts volume/seek/mute via
 * keyboard. Caller calls flash() with an icon + label; auto-clears after the
 * given duration.
 */
export class ControlsFeedback {
    readonly current = signal<{
        icon: string;
        label: string;
        key: number;
    } | null>(null);

    private timer: number | null = null;
    private nextKey = 0;
    private lastRecordingActive = false;
    private recordingFeedbackKey: number | null = null;
    private recordingTransitionKey: string | null | undefined;

    flash(icon: string, label: string, durationMs = 700): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.recordingFeedbackKey = null;
        this.nextKey += 1;
        this.current.set({ icon, label, key: this.nextKey });
        this.timer = window.setTimeout(() => {
            this.current.set(null);
            this.recordingFeedbackKey = null;
            this.timer = null;
        }, durationMs);
    }

    /**
     * Flash a transient overlay on recording start/stop transitions, ignoring
     * repeated states. Tracks the last known active state internally.
     */
    flashRecordingState(
        recording: PlayerRecordingState,
        labels: RecordingFeedbackLabels
    ): void {
        this.flashRecordingTransition(
            recording.active,
            {
                ...labels,
                inactive: recording.message || labels.inactive,
            },
            recording.transitionKey ?? null
        );
    }

    flashRecordingTransition(
        active: boolean,
        labels: RecordingFeedbackLabels,
        transitionKey: string | null = null
    ): void {
        const ownerChanged =
            this.recordingTransitionKey !== undefined &&
            this.recordingTransitionKey !== transitionKey;
        this.recordingTransitionKey = transitionKey;
        if (ownerChanged) {
            this.clearRecordingFeedback();
            this.lastRecordingActive = active;
            return;
        }
        if (active === this.lastRecordingActive) {
            return;
        }
        this.lastRecordingActive = active;
        if (active) {
            this.flash('fiber_manual_record', labels.active, 900);
        } else {
            this.flash('stop_circle', labels.inactive, 900);
        }
        this.recordingFeedbackKey = this.current()?.key ?? null;
    }

    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private clearRecordingFeedback(): void {
        if (
            this.recordingFeedbackKey === null ||
            this.current()?.key !== this.recordingFeedbackKey
        ) {
            return;
        }
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.recordingFeedbackKey = null;
        this.current.set(null);
    }
}
