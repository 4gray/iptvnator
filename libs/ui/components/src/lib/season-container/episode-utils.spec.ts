import {
    formatEpisodePositionText,
    parseDuration,
} from './episode-progress.util';

describe('episode-progress.util', () => {
    it('parses duration strings', () => {
        expect(parseDuration('01:00:30')).toBe(3630);
        expect(parseDuration('45:12')).toBe(2712);
        expect(parseDuration(120)).toBe(120);
        expect(parseDuration(undefined)).toBe(0);
    });

    it('formats remaining time when duration is known', () => {
        expect(
            formatEpisodePositionText({
                contentXtreamId: 1,
                contentType: 'episode',
                positionSeconds: 60,
                durationSeconds: 360,
            })
        ).toBe('05:00 left');
    });

    it('returns null for watched or missing positions', () => {
        expect(formatEpisodePositionText(undefined)).toBeNull();
        expect(
            formatEpisodePositionText({
                contentXtreamId: 1,
                contentType: 'episode',
                positionSeconds: 350,
                durationSeconds: 360,
            })
        ).toBeNull();
    });
});
