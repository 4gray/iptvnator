import { Injectable } from '@angular/core';

/** Keys a history write can be confirmed by: stream URLs or session keys. */
export type PlaybackHistoryKeys = readonly (string | null | undefined)[];

interface PendingHistoryWrite {
    readonly keys: ReadonlySet<string>;
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
 * the keys the playback will be known by (its stream URL, or a playback
 * session key), and whoever observes the playback `confirm`s those keys:
 * the inline players once the stream has advanced for a couple of seconds,
 * and the external-player session as soon as MPV/VLC is launched. A stream
 * that fails before that point never reaches history or the dashboard hero.
 *
 * Several writers may defer under the same key; one confirmation commits
 * all of them. A write whose keys are all empty cannot be confirmed and is
 * committed immediately, as before this gate existed.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackHistoryGate {
    private pending: PendingHistoryWrite[] = [];

    defer(keys: PlaybackHistoryKeys, commit: () => void): void {
        const normalized = normalizeKeys(keys);
        if (normalized.size === 0) {
            runCommit(commit);
            return;
        }

        this.pending.push({ keys: normalized, commit });
        if (this.pending.length > MAX_PENDING_HISTORY_WRITES) {
            this.pending.shift();
        }
    }

    confirm(keys: PlaybackHistoryKeys): void {
        const normalized = normalizeKeys(keys);
        if (normalized.size === 0 || this.pending.length === 0) {
            return;
        }

        const matched: PendingHistoryWrite[] = [];
        const remaining: PendingHistoryWrite[] = [];
        for (const write of this.pending) {
            const matches = [...write.keys].some((key) => normalized.has(key));
            (matches ? matched : remaining).push(write);
        }
        this.pending = remaining;
        matched.forEach((write) => runCommit(write.commit));
    }
}

function normalizeKeys(keys: PlaybackHistoryKeys): ReadonlySet<string> {
    return new Set(
        keys
            .map((key) => key?.trim() ?? '')
            .filter((key): key is string => key.length > 0)
    );
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
