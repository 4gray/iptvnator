import {
    getXtreamRecentlyAddedMaxEpochSeconds,
    toXtreamRecentlyAddedTimestamp,
} from './xtream-recently-added.utils';

describe('Xtream recently-added timestamp helpers', () => {
    const now = Date.parse('2026-05-19T00:00:00.000Z');

    it('treats far-future provider timestamps as invalid for recent ranking', () => {
        expect(toXtreamRecentlyAddedTimestamp('1893456000', now)).toBe(0);
    });

    it('normalizes valid epoch seconds to milliseconds', () => {
        expect(toXtreamRecentlyAddedTimestamp('1779062400', now)).toBe(
            Date.parse('2026-05-18T00:00:00.000Z')
        );
    });

    it('treats the epoch unit threshold itself as milliseconds', () => {
        expect(toXtreamRecentlyAddedTimestamp('10000000000', now)).toBe(
            10_000_000_000
        );
    });

    it('builds the query upper-bound with the same future grace window', () => {
        expect(getXtreamRecentlyAddedMaxEpochSeconds(now)).toBe('1779235200');
    });
});
