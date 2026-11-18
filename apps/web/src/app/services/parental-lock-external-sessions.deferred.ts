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

/** How a session's media was opened, as the eager half saw it. */
export interface ExternalSessionLaunch {
    readonly sourceId: string | null;
    readonly openedLocked: boolean;
}

/** What the eager half saw before the tracker loaded. */
export interface ExternalSessionsHandoff {
    pageStartedAt: number;
    /** The last relock or lock-set change. */
    lockedAt: number;
    /** The lock-set revision `lockedAt` accounts for. */
    lockRevision: number;
    /**
     * Each session's media as first reported, or as switched to by a reused
     * player: the route source it was opened from, and whether the app was
     * locked then (opened from the filtered catalog).
     */
    launchSources: ReadonlyMap<string, ExternalSessionLaunch>;
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
    retryMs?: number;
}

/** At most this many launch routes are kept until the tracker loads. */
const MAX_LAUNCH_SOURCES = 64;
/** A failed chunk load (an update replaced it, a slow disk) is retried. */
const LOAD_RETRIES = 2;
const LOAD_RETRY_MS = 5000;

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
    private wasLocked: boolean;
    private readonly launchSources = new Map<
        string,
        ExternalSessionLaunch & { streamUrl: string }
    >();
    private readonly now: () => number;

    constructor(
        private readonly deps: DeferredExternalSessionsDeps,
        hooks: DeferredExternalSessionsHooks = {}
    ) {
        this.now = hooks.now ?? Date.now;
        // A page starts locked (or with the feature off).
        this.pageStartedAt = this.lockedAt = this.now();
        this.lockRevision = deps.lockRevision();
        this.wasLocked = deps.isLocked();
        const bridge =
            typeof window === 'undefined' ? undefined : window.electron;
        if (
            typeof bridge?.onExternalPlayerSessionUpdate !== 'function' &&
            typeof bridge?.onEmbeddedMpvSessionUpdate !== 'function'
        ) {
            return;
        }
        const stopWatching = bridge.onExternalPlayerSessionUpdate?.(
            ({ id, streamUrl }) => {
                const seen = this.launchSources.get(id);
                if (seen?.streamUrl === streamUrl) return;
                if (!seen && this.launchSources.size >= MAX_LAUNCH_SOURCES) {
                    return;
                }
                this.launchSources.set(id, {
                    streamUrl,
                    sourceId: sourceIdOfRoute(this.deps.routeUrl()),
                    openedLocked: this.deps.isLocked(),
                });
            }
        );
        const load =
            hooks.load ?? (() => import('./parental-lock-external-sessions'));
        const retryMs = hooks.retryMs ?? LOAD_RETRY_MS;
        const attempt = (retries: number): void => {
            load()
                .then(({ ParentalLockExternalSessions }) => {
                    const tracker = this.deps.injector.get(
                        ParentalLockExternalSessions
                    );
                    stopWatching?.();
                    tracker.start({
                        pageStartedAt: this.pageStartedAt,
                        lockedAt: this.lockedAt,
                        lockRevision: this.lockRevision,
                        launchSources: new Map(
                            [...this.launchSources].map(
                                ([id, { sourceId, openedLocked }]) => [
                                    id,
                                    { sourceId, openedLocked },
                                ]
                            )
                        ),
                    });
                    this.tracker = tracker;
                })
                .catch((error) => {
                    if (retries > 0) {
                        setTimeout(() => attempt(retries - 1), retryMs);
                        return;
                    }
                    console.error(
                        'Failed to load the external player parental lock.',
                        error
                    );
                });
        };
        (hooks.schedule ?? afterFirstScreen)(() => attempt(LOAD_RETRIES));
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
        // A relock or a lock-set change; other version bumps while locked
        // would count a session launched from the filtered catalog as
        // having raced a relock.
        const revision = this.deps.lockRevision();
        const locked = this.deps.isLocked();
        if ((locked && !this.wasLocked) || revision !== this.lockRevision) {
            this.lockedAt = this.now();
        }
        this.lockRevision = revision;
        this.wasLocked = locked;
    }
}
