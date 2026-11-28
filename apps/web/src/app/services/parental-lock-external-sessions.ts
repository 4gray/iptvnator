import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import {
    type ExternalSessionLaunch,
    ParentalLockExternalLaunches,
    ParentalLockLockStore,
    ParentalLockService,
    ParentalLockSessionOwners,
    sourceIdOfRoute,
} from '@iptvnator/services';
import {
    type EmbeddedMpvSession,
    type ExternalPlayerSession,
    parentalLockSetKey,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';
import { ExternalPlaybackService } from './external-playback.service';
import type { ExternalSessionsHandoff } from './parental-lock-external-sessions.deferred';

/**
 * MPV/VLC report a film's position every few seconds. A position that moved within
 * this window means the film is playing; a paused one stops moving.
 */
export const EXTERNAL_PROGRESS_WINDOW_MS = 15_000;

const CLOSE_RETRY_MS = 1_000;

type Tracked = {
    session: ExternalPlayerSession;
    /** Its media was opened while unlocked: may show withheld content. */
    tainted: boolean;
    /** The session's source; `null` when it cannot be told. */
    sourceId: string | null;
    /** The locks of `sourceId` (any source's when unknown) last judged. */
    lockKey?: string;
    closing: boolean;
    /** Dismissed from the dock by the relock. */
    hidden?: boolean;
    retry?: ReturnType<typeof setTimeout>;
    position?: number;
    progressAt?: number;
};

function isOpen(session: ExternalPlayerSession): boolean {
    return (
        session.status !== 'closed' &&
        (session.status !== 'error' || session.canClose)
    );
}

/**
 * The parental lock for players that render outside the page.
 *
 * Relock: an MPV/VLC session carries no category, so a session started (or
 * switched) while unlocked is closed when its source has any locked
 * category — any source has, when the source is unknown — or the lock store
 * is unreadable. A session launched while locked came from the filtered
 * catalog and keeps playing. Features that know the category claim their
 * sessions through `ParentalLockSessionOwners` and close only withheld ones.
 *
 * Idle relock: Embedded MPV counts as busy while `playing`, an MPV/VLC film
 * or episode while its reported position moves. Live MPV/VLC cannot report a
 * pause, so it does not hold the lock open.
 */
@Injectable({ providedIn: 'root' })
export class ParentalLockExternalSessions {
    private readonly lock = inject(ParentalLockService);
    private readonly locks = inject(ParentalLockLockStore);
    private readonly owners = inject(ParentalLockSessionOwners);
    private readonly playback = inject(ExternalPlaybackService);
    private readonly externalLaunches = inject(ParentalLockExternalLaunches);
    private readonly router = inject(Router);
    private readonly sessions = new Map<string, Tracked>();
    private readonly embeddedPlaying = new Set<string>();
    private lockedAt = Number.NEGATIVE_INFINITY;
    private pageStartedAt = Number.NEGATIVE_INFINITY;
    private trackerStartedAt = Number.NEGATIVE_INFINITY;
    private lockSet = '';
    private wasLocked = true;
    private launchSources: ReadonlyMap<string, ExternalSessionLaunch> =
        new Map();
    private started = false;

    /** The clock; a field so specs can substitute it. */
    now = (): number => Date.now();

    /**
     * `handoff` carries what the eager half saw before this loaded: when the
     * page started (locked, or with the feature off), when it last locked or
     * its lock set changed, and how each session's media was opened. A
     * session the page did not see open — still running across a reload or
     * a crashed renderer — has an unknown history and is treated as opened
     * unlocked; one opened while this was loading is judged by how it was
     * opened and by the lock edits since.
     */
    start(handoff: ExternalSessionsHandoff): void {
        if (this.started) {
            return;
        }
        this.started = true;
        this.pageStartedAt = handoff.pageStartedAt;
        this.lockedAt = handoff.lockedAt;
        this.launchSources = handoff.launchSources;
        this.trackerStartedAt = this.now();
        this.lockSet = handoff.lockSet;
        this.wasLocked = this.lock.active();
        const bridge = window.electron;
        bridge?.onExternalPlayerSessionUpdate?.((session) =>
            this.observe(session)
        );
        bridge?.onPlaybackPositionUpdate?.((position) =>
            this.observePosition(position)
        );
        bridge?.onEmbeddedMpvSessionUpdate?.((session) =>
            this.observeEmbedded(session)
        );
        void bridge
            ?.listExternalPlayerSessions?.()
            .then((sessions) =>
                sessions.forEach((session) => {
                    if (!this.sessions.has(session.id)) this.observe(session);
                })
            )
            .catch(() => undefined);
    }

    /** Called on every lock version change: closes on relock, shows on unlock. */
    onLockChange(): void {
        // A session carries no category, so a lock-set change may withhold
        // what any open one plays, however it was opened.
        // Only its own source's locks count: an edit of another source also
        // changes the lock set. A save that changed nothing changes neither.
        const lockSet = this.lockKeyOf(null);
        if (lockSet !== this.lockSet) {
            this.lockSet = lockSet;
            this.lockedAt = this.now();
            this.sessions.forEach((entry) => {
                const key = this.lockKeyOf(entry.sourceId);
                if (key !== entry.lockKey) {
                    entry.lockKey = key;
                    entry.tainted = true;
                }
            });
        }
        // Only a relock: other version bumps while locked would count a
        // session launched from the filtered catalog as having raced one.
        const locked = this.lock.active();
        if (locked && !this.wasLocked) {
            this.lockedAt = this.now();
        }
        this.wasLocked = locked;
        for (const entry of [...this.sessions.values()]) {
            this.enforce(entry);
        }
    }

    isBusy(): boolean {
        if (this.embeddedPlaying.size > 0) {
            return true;
        }
        const now = this.now();
        return [...this.sessions.values()].some(
            ({ session, progressAt }) =>
                !!session.contentInfo &&
                (session.status === 'opened' || session.status === 'playing') &&
                progressAt !== undefined &&
                now - progressAt <= EXTERNAL_PROGRESS_WINDOW_MS
        );
    }

    private observe(session: ExternalPlayerSession): void {
        const current = this.sessions.get(session.id);
        if (!isOpen(session)) {
            clearTimeout(current?.retry);
            this.sessions.delete(session.id);
            return;
        }
        const launch = current ? undefined : this.launchOf(session);
        const entry: Tracked = current ?? {
            session,
            tainted: false,
            sourceId: launch
                ? (launch.sourceId ?? null)
                : this.launchSourceOf(session),
            closing: false,
        };
        const switched =
            !!current && current.session.streamUrl !== session.streamUrl;
        if (switched) {
            // New media plays the source it was switched from.
            entry.sourceId = sourceIdOfRoute(this.router.url);
        }
        entry.session = session;
        entry.sourceId = session.contentInfo?.playlistId ?? entry.sourceId;
        if (!current || switched) {
            entry.lockKey = this.lockKeyOf(entry.sourceId);
        }
        // A recorded launch may have been delayed by settings or player
        // preparation. Judge it by the request and any subsequent lock edit.
        const openedUnlocked = launch
            ? !launch.openedLocked || launch.lockKey !== entry.lockKey
            : (!this.lock.active() && (!current || switched)) ||
              (!current && Date.parse(session.startedAt) <= this.lockedAt);
        if (openedUnlocked) {
            entry.tainted = true;
        }
        this.sessions.set(session.id, entry);
        this.enforce(entry);
    }

    private observePosition(position: PlaybackPositionData): void {
        const entry = position.sessionId
            ? this.sessions.get(position.sessionId)
            : undefined;
        if (!entry || entry.position === position.positionSeconds) {
            return;
        }
        entry.position = position.positionSeconds;
        entry.progressAt = this.now();
    }

    private observeEmbedded(session: EmbeddedMpvSession): void {
        if (session.status === 'playing') {
            this.embeddedPlaying.add(session.id);
        } else {
            this.embeddedPlaying.delete(session.id);
        }
    }

    private needsClose(entry: Tracked): boolean {
        return (
            this.lock.active() &&
            entry.tainted &&
            !this.owners.isOwned(entry.session) &&
            // Unreadable locks withhold every category; otherwise any
            // locked category of the source (of any, when unknown) counts.
            (this.lock.withholdsEverything() ||
                this.locks.hasLocks(entry.sourceId))
        );
    }

    private enforce(entry: Tracked): void {
        const { session } = entry;
        if (this.sessions.get(session.id) !== entry) {
            return;
        }
        if (!this.needsClose(entry)) {
            clearTimeout(entry.retry);
            entry.retry = undefined;
            // Unlocked before it could be closed: show it in the dock again.
            if (entry.hidden && !entry.closing) {
                entry.hidden = false;
                this.playback.restoreDismissedSession(session.id);
            }
            return;
        }
        if (this.playback.activeSession()?.id === session.id) {
            entry.hidden = true;
            this.playback.dismissActiveSession();
        }
        const bridge = window.electron;
        if (
            !session.canClose ||
            !bridge?.closeExternalPlayerSession ||
            entry.closing ||
            entry.retry
        ) {
            return;
        }
        entry.closing = true;
        bridge.closeExternalPlayerSession(session.id, true).then(
            (result) => {
                entry.closing = false;
                if (result && isOpen(result)) {
                    // The launch has no closer yet; its next update runs the
                    // close again. Recheck now when an update already
                    // arrived or the app was unlocked meanwhile.
                    if (entry.session !== session || !this.needsClose(entry)) {
                        this.enforce(entry);
                    }
                    return;
                }
                this.observe(
                    result ?? {
                        ...session,
                        status: 'closed',
                        canClose: false,
                        closedByRequest: true,
                    }
                );
            },
            () => {
                entry.closing = false;
                if (this.sessions.get(session.id) !== entry) {
                    return;
                }
                if (!this.needsClose(entry)) {
                    this.enforce(entry);
                    return;
                }
                entry.retry = setTimeout(() => {
                    entry.retry = undefined;
                    this.enforce(entry);
                }, CLOSE_RETRY_MS);
            }
        );
    }

    /**
     * What a lock edit is compared by: the source's locks, or every
     * source's when it cannot be told (any edit may concern it).
     */
    private lockKeyOf(sourceId: string | null): string {
        return parentalLockSetKey(this.locks.lockSet(), sourceId);
    }

    /** The source route a new session was launched from, when known. */
    private launchSourceOf(session: ExternalPlayerSession): string | null {
        const startedAt = Date.parse(session.startedAt);
        // The route at a reload is not the one the launch was made from.
        if (startedAt < this.pageStartedAt) return null;
        return sourceIdOfRoute(this.router.url);
    }

    /**
     * A session from a previous renderer, or missed by the eager listener,
     * has an unknown history and counts as opened while unlocked.
     */
    private launchOf(
        session: ExternalPlayerSession
    ): Partial<ExternalSessionLaunch> | undefined {
        const seen = this.launchSources.get(session.id);
        if (seen) return seen;
        if (session.requestId) {
            return (
                this.externalLaunches.take(session.requestId) ?? {
                    openedLocked: false,
                }
            );
        }
        return Date.parse(session.startedAt) < this.trackerStartedAt
            ? { openedLocked: false }
            : undefined;
    }
}
