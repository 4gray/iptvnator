import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { episodeTimeLabel, formatEpisodeAirDate } from './episode-meta.util';

const position = (
    positionSeconds: number,
    durationSeconds = 2700
): PlaybackPositionData => ({
    contentXtreamId: 1,
    contentType: 'episode',
    positionSeconds,
    durationSeconds,
});

describe('episodeTimeLabel', () => {
    it('shows the runtime for an unstarted or a watched episode', () => {
        expect(episodeTimeLabel({ duration_secs: 2760 }, undefined)).toEqual({
            key: 'PORTALS.DETAIL.DURATION_MINUTES',
            params: { minutes: 46 },
        });
        expect(
            episodeTimeLabel({ duration_secs: 2760 }, position(2700, 2760))
        ).toEqual({
            key: 'PORTALS.DETAIL.DURATION_MINUTES',
            params: { minutes: 46 },
        });
    });

    it('shows the time left for a started episode', () => {
        expect(
            episodeTimeLabel({ duration_secs: 2760 }, position(840))
        ).toEqual({
            key: 'WORKSPACE.DASHBOARD.REMAINING_MINUTES',
            params: { minutes: 31 },
        });
    });

    it('is null when the provider sent no runtime', () => {
        expect(episodeTimeLabel({}, undefined)).toBeNull();
        expect(episodeTimeLabel(undefined, undefined)).toBeNull();
    });
});

describe('formatEpisodeAirDate', () => {
    const now = new Date(2026, 9, 8);

    it('drops the year for a date in the current year', () => {
        expect(formatEpisodeAirDate('2026-01-12', 'en', now)).toBe('Jan 12');
    });

    it('keeps the year for an older date', () => {
        expect(formatEpisodeAirDate('2019-01-12', 'en', now)).toBe(
            'Jan 12, 2019'
        );
    });

    it('reads an ISO day as a local calendar day', () => {
        const label = formatEpisodeAirDate('2026-03-01', 'en', now);
        expect(label).toBe('Mar 1');
    });

    it('maps app locale codes', () => {
        expect(formatEpisodeAirDate('2026-01-12', 'ru', now)).toMatch(
            /^12 янв/
        );
    });

    it('is empty for missing or unparseable dates', () => {
        expect(formatEpisodeAirDate(undefined, 'en', now)).toBe('');
        expect(formatEpisodeAirDate('  ', 'en', now)).toBe('');
        expect(formatEpisodeAirDate('soon', 'en', now)).toBe('');
    });
});
