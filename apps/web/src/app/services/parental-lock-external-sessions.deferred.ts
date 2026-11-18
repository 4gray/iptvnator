import type { Injector } from '@angular/core';
import type { ParentalLockExternalSessions } from './parental-lock-external-sessions';

type IdleScheduler = (run: () => void, options: { timeout: number }) => number;

/** A source route; a launch from it plays that source's content. */
const SOURCE_ROUTE = /^\/workspace\/(?:playlists|xtreams|stalker)\/([^/?#]+)/;

/** The source a route belongs to; `null` outside a source. */
export function sourceIdOfRoute(url: string | undefined): string | null {
    const match = SOURCE_ROUTE.exec(url ?? '');
    return match ? decodeURIComponent(match[1]) : null;
}

/** What the eager half saw before the tracker loaded. */
export interface ExternalSessionsHandoff {
    pageStartedAt: number;
    /** The last relock or lock-set change. */
    lockedAt: number;
    /** The route source of each session at its first report. */
    launchSources: ReadonlyMap<string, string | null>;
}

export interface DeferredExternalSessionsDeps {
    injector: Injector;
    isLocked: () => boolean;
    /** Bumps whenever the lock set changes. */
    lockRevision: () => number;
    routeUrl: () => string | undefined;
}

export interface DeferredExternalSessionsHooks {
    now?: () => number;
    schedule?: (run: () => void) => void;
    load?: () => Promise<typeof import('./parental-lock-external-sessions')>;
}

/** At most this many launch routes are kept until the tracker loads. */
const MAX_LAUNCH_SOURCES = 64;

/** Waits for the first screen, then for an idle moment (5 s at most). */
export function afterFirstScreen(run: () => void): void {
    const idle = (globalThis as { requestIdleCallback?: IdleScheduler })
        .requestIdleCallback;
    setTimeout(() => (idle ? idle(run, { timeout: 5000 }) : run()), 1000);
}

/**
 * The eager half of `ParentalLockExternalSessions`. The tracker and the
 * session listing it starts with stay off the startup path: they load once
 * the first screen has rendered (and only where the bridge reports MPV/VLC
 * or Embedded MPV). The listing covers every session opened meanwhile, so
 * this half only keeps what the tracker judges them by: when the page
 * started, when it last locked or its lock set changed, and the route each
 * session was first reported on (a session's source when it has no
 * `contentInfo`). Listener registrations are not bridge calls.
 */
export class DeferredExternalSessions {
    private tracker: ParentalLockExternalSessions | null = null;
    private readonly pageStartedAt: number;
    private lockedAt: number;
    private lockRevision: number;
    private readonly launchSources = new Map<string, string | null>();
    private readonly now: () => number;

    constructor(
        private readonly deps: DeferredExternalSessionsDeps,
        hooks: DeferredExternalSessionsHooks = {}
    ) {
        this.now = hooks.now ?? Date.now;
        // A page starts locked (or with the feature off).
        this.pageStartedAt = this.lockedAt = this.now();
        this.lockRevision = deps.lockRevision();
        const bridge =
            typeof window === 'undefined' ? undefined : window.electron;
        if (
            typeof bridge?.onExternalPlayerSessionUpdate !== 'function' &&
            typeof bridge?.onEmbeddedMpvSessionUpdate !== 'function'
        ) {
            return;
        }
        const stopWatching = bridge.onExternalPlayerSessionUpdate?.(
            ({ id }) => {
                if (
                    !this.launchSources.has(id) &&
                    this.launchSources.size < MAX_LAUNCH_SOURCES
                ) {
                    this.launchSources.set(
                        id,
                        sourceIdOfRoute(this.deps.routeUrl())
                    );
                }
            }
        );
        const load =
            hooks.load ?? (() => import('./parental-lock-external-sessions'));
        (hooks.schedule ?? afterFirstScreen)(() => {
            load()
                .then(({ ParentalLockExternalSessions }) => {
                    const tracker = this.deps.injector.get(
                        ParentalLockExternalSessions
                    );
                    stopWatching?.();
                    tracker.start({
                        pageStartedAt: this.pageStartedAt,
                        lockedAt: this.lockedAt,
                        launchSources: new Map(this.launchSources),
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
            return;
        }
        const revision = this.deps.lockRevision();
        if (this.deps.isLocked() || revision !== this.lockRevision) {
            this.lockedAt = this.now();
        }
        this.lockRevision = revision;
    }
}
