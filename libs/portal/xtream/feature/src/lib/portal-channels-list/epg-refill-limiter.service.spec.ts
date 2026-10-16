import { TestBed } from '@angular/core/testing';
import {
    EPG_REFILL_MIN_INTERVAL_MS,
    EpgRefillLimiter,
} from './epg-refill-limiter.service';

describe('EpgRefillLimiter', () => {
    let limiter: EpgRefillLimiter;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        limiter = TestBed.inject(EpgRefillLimiter);
    });

    it('is one shared instance for every mounted channel list', () => {
        // The sidebar list and the fullscreen channel panel are mounted at
        // once over a single EPG queue; a record per component would give
        // each copy its own allowance and divide the floor between them.
        expect(TestBed.inject(EpgRefillLimiter)).toBe(limiter);
    });

    it('allows one claim per interval and then blocks', () => {
        expect(limiter.claim('playlist-1', 1, 0)).toBe(true);
        expect(
            limiter.claim('playlist-1', 1, EPG_REFILL_MIN_INTERVAL_MS - 1)
        ).toBe(false);
        expect(limiter.claim('playlist-1', 1, EPG_REFILL_MIN_INTERVAL_MS)).toBe(
            true
        );
    });

    it('tracks each stream separately', () => {
        expect(limiter.claim('playlist-1', 1, 0)).toBe(true);
        expect(limiter.claim('playlist-1', 2, 0)).toBe(true);
    });

    it('lets a released stream claim again straight away', () => {
        limiter.claim('playlist-1', 1, 0);
        limiter.release('playlist-1', 1);

        expect(limiter.claim('playlist-1', 1, 1)).toBe(true);
    });

    it('forgets records only once they have expired', () => {
        limiter.claim('playlist-1', 1, 0);

        limiter.forgetExpired(EPG_REFILL_MIN_INTERVAL_MS - 1);
        expect(
            limiter.claim('playlist-1', 1, EPG_REFILL_MIN_INTERVAL_MS - 1)
        ).toBe(false);

        limiter.forgetExpired(EPG_REFILL_MIN_INTERVAL_MS);
        expect(limiter.claim('playlist-1', 1, EPG_REFILL_MIN_INTERVAL_MS)).toBe(
            true
        );
    });

    it('does not let one playlist hold back another playlist same stream id', () => {
        // Stream ids are provider-local and the root-provided service outlives
        // a playlist switch, so two accounts numbering a channel alike must
        // not share an allowance.
        expect(limiter.claim('playlist-1', 1, 0)).toBe(true);

        expect(limiter.claim('playlist-2', 1, 0)).toBe(true);
    });

    it('holds a claim across a row scrolling out of view and back', () => {
        // Housekeeping runs on every tick while the row is off screen; the
        // floor must survive it, or scrolling up and down the list would hand
        // out a fresh request each pass.
        limiter.claim('playlist-1', 1, 0);

        limiter.forgetExpired(60_000);
        limiter.forgetExpired(120_000);

        expect(limiter.claim('playlist-1', 1, 180_000)).toBe(false);
    });
});
