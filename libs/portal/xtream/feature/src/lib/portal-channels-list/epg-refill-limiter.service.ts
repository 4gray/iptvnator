import { Injectable } from '@angular/core';

/**
 * Floor between two refills of the same channel's exhausted guide. Matches
 * the EPG queue's own cache lifetime, so a provider with no fresh data is
 * asked no more often than its cached answer would have expired anyway.
 */
export const EPG_REFILL_MIN_INTERVAL_MS = 5 * 60_000;

/**
 * Rate limit for the one place that overrides the EPG queue's own throttling:
 * dropping a cached guide whose programmes have all ended so that it can be
 * fetched again.
 *
 * A provider whose guide has genuinely run out answers that refill with the
 * same finished programmes, which would leave the row stale and ask again on
 * the very next tick — one request per visible channel per minute, against the
 * queue that exists to keep providers from banning the client.
 *
 * Root-provided on purpose, and keyed by bare stream id exactly like the
 * queue's own cache: a live layout mounts the channel list more than once
 * (the sidebar and the fullscreen channel panel render side by side) over one
 * shared queue, so a per-component record would hand every mounted copy its
 * own allowance and divide the floor between them.
 */
@Injectable({ providedIn: 'root' })
export class EpgRefillLimiter {
    private readonly requestedAt = new Map<number, number>();

    /** True when this stream may be refilled now, recording the attempt. */
    claim(streamId: number, wallClockMs: number): boolean {
        const previous = this.requestedAt.get(streamId);
        if (
            previous !== undefined &&
            wallClockMs - previous < EPG_REFILL_MIN_INTERVAL_MS
        ) {
            return false;
        }

        this.requestedAt.set(streamId, wallClockMs);
        return true;
    }

    /** The guide is flowing again, so the next gap may refill immediately. */
    release(streamId: number): void {
        this.requestedAt.delete(streamId);
    }

    /**
     * Drops records that have outlived the interval and so no longer hold
     * anything back, which is what keeps the map bounded.
     *
     * Deliberately not keyed on the viewport: a claim dropped when its row
     * scrolls out of sight would be handed back the moment the user scrolled
     * to it again, and a few passes up and down the list would bypass the
     * floor entirely.
     */
    forgetExpired(wallClockMs: number): void {
        for (const [streamId, requestedAt] of this.requestedAt) {
            if (wallClockMs - requestedAt >= EPG_REFILL_MIN_INTERVAL_MS) {
                this.requestedAt.delete(streamId);
            }
        }
    }
}
