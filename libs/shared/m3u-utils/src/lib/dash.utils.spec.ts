import { isDashChannel, isDashStreamUrl } from './dash.utils';

describe('dash.utils', () => {
    it.each([
        'https://example.com/live/stream.mpd',
        'https://example.com/live/stream.MPD',
        'https://example.com/live/stream.mpd?token=abc#frag',
        'https://example.com/play?extension=mpd',
        'https://example.com/play?ext=mpd',
        'https://example.com/play?format=mpd',
    ])('detects %s as DASH', (url) => {
        expect(isDashStreamUrl(url)).toBe(true);
    });

    it.each([
        'https://example.com/live/playlist.m3u8',
        'https://example.com/live/stream.ts',
        'https://example.com/live.php?id=7',
        'https://example.com/movie.mp4',
        '',
        undefined,
    ])('does not flag %s as DASH', (url) => {
        expect(isDashStreamUrl(url as string | undefined)).toBe(false);
    });

    it('detects DASH channels by their stream URL', () => {
        expect(
            isDashChannel({ url: 'https://example.com/enc.mpd' })
        ).toBe(true);
        expect(
            isDashChannel({ url: 'https://example.com/live.m3u8' })
        ).toBe(false);
        expect(isDashChannel(null)).toBe(false);
        expect(isDashChannel(undefined)).toBe(false);
    });
});
