import type { Injector } from '@angular/core';
import {
    type ExternalSessionLaunch,
    ParentalLockExternalLaunches,
    sourceIdOfRoute,
} from '@iptvnator/services';
import type { ParentalLockExternalSessions } from './parental-lock-external-sessions';

type IdleScheduler = (run: () => void, options: { timeout: number }) => number;

/** What the eager half saw before the tracker loaded. */
export interface ExternalSessionsHandoff {
    pageStartedAt: number;
    /** The last relock or lock-set change. */
    lockedAt: number;
    /** The lock set (`lockSetKey(null)`) `lockedAt` accounts for. */
    lockSet: string;
    /**
     * Each session's media as first reported, or as switched to by a reused
     * player: the route source it was opened from, whether the app was
     * locked then, and the locks it was opened under.
     */
    launchSources: ReadonlyMap<string, ExternalSessionLaunch>;
}

export interface DeferredExternalSessionsDeps {
    injector: Injector;
    isLocked: () => boolean;
    /** What a source (any, when `null`) locks; a no-op save keeps it. */
    lockSetKey: (sourceId: string | null) => string;
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
 * started, when it last locked or its lock set changed, and how each
 * session's media was opened: the route (its source when it has no
 * `contentInfo`), whether from the filtered catalog, and under which locks.
 * Listener registrations are not bridge calls.
 */
export class DeferredExternalSessions {
    private tracker: ParentalLockExternalSessions | null = null;
    private readonly pageStartedAt: number;
    private lockedAt: number;
    private lockSet: string;
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
        this.lockSet = deps.lockSetKey(null);
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
            ({ id, streamUrl, startedAt, contentInfo, requestId }) => {
                const seen = this.launchSources.get(id);
                if (seen?.streamUrl === streamUrl) return;
                if (!seen && this.launchSources.size >= MAX_LAUNCH_SOURCES) {
                    return;
                }
                if (!seen && requestId) {
                    const launch = deps.injector
                        .get(ParentalLockExternalLaunches)
                        .take(requestId) ?? {
                        sourceId: contentInfo?.playlistId ?? null,
                        openedLocked: false,
                        lockKey: deps.lockSetKey(
                            contentInfo?.playlistId ?? null
                        ),
                    };
                    this.launchSources.set(id, { streamUrl, ...launch });
                    return;
                }
                const sourceId = sourceIdOfRoute(deps.routeUrl());
                // Media opened unlocked stays so across a switch. A first
                // report after a relock or lock edit the launch preceded
                // raced it: the media was not chosen from what it shows.
                const openedLocked =
                    this.deps.isLocked() &&
                    (seen
                        ? seen.openedLocked
                        : Date.parse(startedAt) > this.lockedAt);
                this.launchSources.set(id, {
                    streamUrl,
                    sourceId,
                    openedLocked,
                    lockKey: this.deps.lockSetKey(
                        contentInfo?.playlistId ?? sourceId
                    ),
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
                        lockSet: this.lockSet,
                        launchSources: new Map(
                            [...this.launchSources].map(
                                ([id, { sourceId, openedLocked, lockKey }]) => [
                                    id,
                                    { sourceId, openedLocked, lockKey },
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
        // A relock or a lock-set change; other version bumps (a save that
        // changed nothing, a re-stamp) would count a session launched from
        // the filtered catalog as having raced a relock.
        const lockSet = this.deps.lockSetKey(null);
        const locked = this.deps.isLocked();
        if ((locked && !this.wasLocked) || lockSet !== this.lockSet) {
            this.lockedAt = this.now();
        }
        this.lockSet = lockSet;
        this.wasLocked = locked;
    }
}
