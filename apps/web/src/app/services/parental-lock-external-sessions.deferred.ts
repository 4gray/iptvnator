import type { Injector } from '@angular/core';
import type { ParentalLockExternalSessions } from './parental-lock-external-sessions';

type IdleScheduler = (run: () => void, options: { timeout: number }) => number;

/** Waits for the first screen, then for an idle moment (5 s at most). */
export function afterFirstScreen(run: () => void): void {
    const idle = (globalThis as { requestIdleCallback?: IdleScheduler })
        .requestIdleCallback;
    setTimeout(() => (idle ? idle(run, { timeout: 5000 }) : run()), 1000);
}

/** This runtime reports players that render outside the page. */
function hasExternalPlayerBridge(): boolean {
    const bridge = typeof window === 'undefined' ? undefined : window.electron;
    return (
        typeof bridge?.onExternalPlayerSessionUpdate === 'function' ||
        typeof bridge?.onEmbeddedMpvSessionUpdate === 'function'
    );
}

/**
 * The eager half of `ParentalLockExternalSessions`. The tracker and the
 * session listing it starts with stay off the startup path: they load once
 * the first screen has rendered (and only where the bridge reports MPV/VLC
 * or Embedded MPV). The listing covers every session opened meanwhile, so
 * this half only keeps the clock readings the tracker judges them by: when
 * the page started and when it last locked.
 */
export class DeferredExternalSessions {
    private tracker: ParentalLockExternalSessions | null = null;
    private readonly pageStartedAt: number;
    private lockedAt: number;

    constructor(
        private readonly injector: Injector,
        private readonly isLocked: () => boolean,
        private readonly now: () => number = Date.now,
        schedule: (run: () => void) => void = afterFirstScreen,
        load: () => Promise<
            typeof import('./parental-lock-external-sessions')
        > = () => import('./parental-lock-external-sessions')
    ) {
        // A page starts locked (or with the feature off).
        this.pageStartedAt = this.lockedAt = this.now();
        if (!hasExternalPlayerBridge()) {
            return;
        }
        schedule(() => {
            load()
                .then(({ ParentalLockExternalSessions }) => {
                    const tracker = this.injector.get(
                        ParentalLockExternalSessions
                    );
                    tracker.start({
                        pageStartedAt: this.pageStartedAt,
                        lockedAt: this.lockedAt,
                    });
                    this.tracker = tracker;
                })
                .catch((error) =>
                    console.error(
                        'Failed to load the external player parental lock.',
                        error
                    )
                );
        });
    }

    /** False until the tracker has loaded: nothing it counts is seen yet. */
    isBusy(): boolean {
        return this.tracker?.isBusy() ?? false;
    }

    onLockChange(): void {
        if (this.tracker) {
            this.tracker.onLockChange();
        } else if (this.isLocked()) {
            this.lockedAt = this.now();
        }
    }
}
