import { signal } from '@angular/core';

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

    flash(icon: string, label: string, durationMs = 700): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.nextKey += 1;
        this.current.set({ icon, label, key: this.nextKey });
        this.timer = window.setTimeout(() => {
            this.current.set(null);
            this.timer = null;
        }, durationMs);
    }

    /**
     * Flash a transient overlay on recording start/stop transitions, ignoring
     * repeated states. Tracks the last known active state internally.
     */
    flashRecordingTransition(active: boolean): void {
        if (active === this.lastRecordingActive) {
            return;
        }
        this.lastRecordingActive = active;
        if (active) {
            this.flash('fiber_manual_record', 'Recording', 900);
        } else {
            this.flash('stop_circle', 'Recording stopped', 900);
        }
    }

    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
