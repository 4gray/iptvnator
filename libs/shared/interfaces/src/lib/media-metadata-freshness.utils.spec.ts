import {
    getBackgroundMetadataFreshnessCutoff,
    isMediaMetadataDueForSchedule,
} from './media-metadata-freshness.utils';

describe('media metadata freshness utilities', () => {
    const now = Date.UTC(2026, 4, 15);

    it('treats every-opening as a missing-only check', () => {
        expect(
            isMediaMetadataDueForSchedule(
                true,
                now - 90 * 24 * 60 * 60 * 1000,
                'every-opening',
                now
            )
        ).toBe(false);
        expect(
            isMediaMetadataDueForSchedule(false, null, 'every-opening', now)
        ).toBe(true);
    });

    it('marks weekly and monthly metadata stale only after the selected period', () => {
        expect(
            isMediaMetadataDueForSchedule(
                true,
                now - 6 * 24 * 60 * 60 * 1000,
                'weekly',
                now
            )
        ).toBe(false);
        expect(
            isMediaMetadataDueForSchedule(
                true,
                now - 8 * 24 * 60 * 60 * 1000,
                'weekly',
                now
            )
        ).toBe(true);
        expect(
            isMediaMetadataDueForSchedule(
                true,
                now - 29 * 24 * 60 * 60 * 1000,
                'monthly',
                now
            )
        ).toBe(false);
        expect(
            isMediaMetadataDueForSchedule(
                true,
                now - 31 * 24 * 60 * 60 * 1000,
                'monthly',
                now
            )
        ).toBe(true);
    });

    it('exposes a null cutoff for missing-only schedules', () => {
        expect(
            getBackgroundMetadataFreshnessCutoff('every-opening', now)
        ).toBeNull();
        expect(getBackgroundMetadataFreshnessCutoff('weekly', now)).toBe(
            now - 7 * 24 * 60 * 60 * 1000
        );
    });
});
