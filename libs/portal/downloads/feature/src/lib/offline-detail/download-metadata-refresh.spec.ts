import { TMDB_DETAILS_CACHE_TTL_MS } from '@iptvnator/services';
import {
    COMPLETED_METADATA_REFRESH_MAX_ENTRIES,
    CompletedMetadataRefreshThrottle,
} from './download-metadata-refresh';

describe('CompletedMetadataRefreshThrottle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-31T08:30:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('expires completed attempts with the TMDB details TTL', () => {
        const throttle = new CompletedMetadataRefreshThrottle();
        throttle.mark('download:17', 'en', 1);

        expect(throttle.isCompleted('download:17', 'en')).toBe(true);

        jest.advanceTimersByTime(TMDB_DETAILS_CACHE_TTL_MS + 1);

        expect(throttle.isCompleted('download:17', 'en')).toBe(false);
    });

    it('bounds completed attempts by evicting the oldest group and language', () => {
        const throttle = new CompletedMetadataRefreshThrottle();
        for (
            let index = 0;
            index <= COMPLETED_METADATA_REFRESH_MAX_ENTRIES;
            index += 1
        ) {
            throttle.mark(`download:${index}`, 'en', index + 1);
        }

        expect(throttle.isCompleted('download:0', 'en')).toBe(false);
        expect(
            throttle.isCompleted(
                `download:${COMPLETED_METADATA_REFRESH_MAX_ENTRIES}`,
                'en'
            )
        ).toBe(true);
    });

    it('does not let older cleanup erase a newer completed generation', () => {
        const throttle = new CompletedMetadataRefreshThrottle();
        throttle.mark('series:playlist-a:93', 'en', 1);
        throttle.mark('series:playlist-a:93', 'en', 2);

        throttle.clear('series:playlist-a:93', 'en', 1);

        expect(throttle.isCompleted('series:playlist-a:93', 'en')).toBe(true);

        throttle.clear('series:playlist-a:93', 'en', 2);

        expect(throttle.isCompleted('series:playlist-a:93', 'en')).toBe(false);
    });
});
