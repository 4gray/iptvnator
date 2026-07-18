import { signal } from '@angular/core';
import { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';

const STALLED_TIMEOUT_MS = 30_000;

/**
 * Tracks whether a loading embedded-MPV session has stalled: if `status` stays
 * `loading` longer than {@link STALLED_TIMEOUT_MS}, `stalled` flips true so the
 * UI can offer a retry. Any non-loading status cancels the timer and clears the
 * flag. Owns its own timer so the controller stays lifecycle-focused.
 */
export class EmbeddedMpvStalledTracker {
    readonly stalled = signal(false);

    private stalledTimer: number | null = null;

    track(status: EmbeddedMpvSession['status'] | null): void {
        if (status === 'loading') {
            if (this.stalledTimer === null) {
                this.stalledTimer = window.setTimeout(() => {
                    this.stalled.set(true);
                    this.stalledTimer = null;
                }, STALLED_TIMEOUT_MS);
            }
            return;
        }

        this.cancel();
        if (this.stalled()) {
            this.stalled.set(false);
        }
    }

    reset(): void {
        this.cancel();
        this.stalled.set(false);
    }

    cancel(): void {
        if (this.stalledTimer !== null) {
            clearTimeout(this.stalledTimer);
            this.stalledTimer = null;
        }
    }
}
