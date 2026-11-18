import { captureHistoryOwner } from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { Injectable } from '@angular/core';

/** What a playback is known by, for correlating a write with its playback. */
export interface PlaybackHistoryTarget {
    readonly sourceId?: string;
    /**
     * The playing host's `playbackSessionKey` (source and content scoped).
     * A write deferred with one is only confirmed by that same key.
     */
    readonly sessionKey?: string | null;
    /** A particular native launch, even when another launch uses the same URL. */
    readonly launchId?: string | null;
    /** Stream URLs; what a write without a session key is matched by. */
    readonly streamUrls?: readonly (string | null | undefined)[];
}

interface NormalizedTarget {
    readonly sessionKey: string | null;
    readonly launchId: string | null;
    readonly streamUrls: ReadonlySet<string>;
}

interface PendingHistoryWrite {
    readonly target: NormalizedTarget;
    readonly commit: () => void;
}

/**
 * Upper bound on unconfirmed writes. Each click on a channel that never
 * plays leaves one behind; the oldest is dropped rather than kept forever.
 */
const MAX_PENDING_HISTORY_WRITES = 20;

/**
 * Holds "recently viewed" writes back until the stream really plays.
 *
 * The code that resolves a channel or movie is not the code that plays it:
 * a Stalker link is resolved in the store, played by whichever view mounts
 * the player, or handed to MPV/VLC. Writers therefore `defer` the write under
 * what the playback will be known by, and whoever observes the playback
 * `confirm`s it: the inline players once the stream has advanced for a
 * couple of seconds, and the external-player session when it confirms media
 * or opens without readiness support. A stream that fails before that point never reaches history or
 * the dashboard hero.
 *
 * A write deferred with a session key is only confirmed by the same key: the
 * same stream URL can sit in two playlists, and playing it in one — inline
 * or in MPV/VLC — must not
 * record a failed attempt in the other. Writers that cannot know the
 * playing host's key (portal resolvers, collection tabs) defer by stream
 * URL, which any confirmation of that URL matches. Native launches that know
 * their launch ID defer under that ID instead.
 * Several writers may defer for the same playback; one confirmation commits
 * all of them. A write with nothing to match on cannot be confirmed and is
 * committed immediately, as before this gate existed.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackHistoryGate {
    private pending: PendingHistoryWrite[] = [];

    constructor() {
        // Subscribed here rather than in
        // the app-wide external-playback service so the gate stays off the
        // initial bundle: it is created by the first deferred write, which
        // always precedes the launch it waits for.
        const launching = new Set<string>();
        window.electron?.onExternalPlayerSessionUpdate?.((session) => {
            if (session.restoredFromSessionId) return;
            if (session.status === 'launching') {
                launching.add(session.id);
            } else if (
                session.status === 'opened' ||
                session.status === 'playing'
            ) {
                if (
                    session.mediaLoaded === false &&
                    !session.mediaObservationUnavailable
                )
                    return;
                if (launching.delete(session.id))
                    this.confirm({
                        launchId: session.launchId,
                        streamUrls: [session.streamUrl],
                    });
            } else {
                launching.delete(session.id);
            }
        });
    }

    defer(target: PlaybackHistoryTarget, commit: () => void): void {
        const current = captureHistoryOwner(
            sourceConnection()?.instanceId,
            target.sourceId ?? '',
            () => sourceConnection()?.instanceId
        );
        const confirmedCommit = () => {
            if (current()) commit();
        };
        const normalized = normalizeTarget(target);
        if (
            !normalized.sessionKey &&
            !normalized.launchId &&
            normalized.streamUrls.size === 0
        ) {
            runCommit(confirmedCommit);
            return;
        }

        this.pending.push({ target: normalized, commit: confirmedCommit });
        if (this.pending.length > MAX_PENDING_HISTORY_WRITES) {
            this.pending.shift();
        }
    }

    confirm(target: PlaybackHistoryTarget): void {
        const confirmed = normalizeTarget(target);
        const matched: PendingHistoryWrite[] = [];
        const remaining: PendingHistoryWrite[] = [];
        for (const write of this.pending) {
            (matchesTarget(write.target, confirmed) ? matched : remaining).push(
                write
            );
        }
        this.pending = remaining;
        matched.forEach((write) => runCommit(write.commit));
    }
}

function matchesTarget(
    write: NormalizedTarget,
    confirmed: NormalizedTarget
): boolean {
    if (write.sessionKey) {
        return write.sessionKey === confirmed.sessionKey;
    }
    if (write.launchId) return write.launchId === confirmed.launchId;
    return [...write.streamUrls].some((url) => confirmed.streamUrls.has(url));
}

function normalizeTarget(target: PlaybackHistoryTarget): NormalizedTarget {
    return {
        sessionKey: normalizeKey(target.sessionKey),
        launchId: normalizeKey(target.launchId),
        streamUrls: new Set(
            (target.streamUrls ?? [])
                .map(normalizeKey)
                .filter((url): url is string => url !== null)
        ),
    };
}

function normalizeKey(key: string | null | undefined): string | null {
    const trimmed = key?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
}

function runCommit(commit: () => void): void {
    try {
        commit();
    } catch (error) {
        // History is best effort: a failed write must not break playback or
        // the other writes confirmed by the same stream.
        console.error('Failed to record recently viewed item:', error);
    }
}
