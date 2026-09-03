import { PlaybackSourceKind } from './playback-recommendation.model';
import { resolvePlaybackUrlSourceKind } from './playback-source-routing';

describe('resolvePlaybackUrlSourceKind', () => {
    it.each([
        ['https://example.test/live/playlist.m3u8', PlaybackSourceKind.Hls],
        [
            'https://example.test/live/playlist.M3U8?token=signed',
            PlaybackSourceKind.Hls,
        ],
        ['https://example.test/live/list.m3u', PlaybackSourceKind.Hls],
        ['https://example.test/play?format=hls', PlaybackSourceKind.Hls],
        ['https://example.test/live.mpd', PlaybackSourceKind.Dash],
        [
            'https://example.test/stream.MPD?token=signed#frag',
            PlaybackSourceKind.Dash,
        ],
        ['https://example.test/raw.ts', PlaybackSourceKind.MpegTs],
        ['https://example.test/disc.m2ts', PlaybackSourceKind.MpegTs],
        ['https://example.test/live/user/pass/1', PlaybackSourceKind.MpegTs],
        ['https://example.test/live.php?id=7', PlaybackSourceKind.MpegTs],
        ['https://example.test/play?ext=mpegts', PlaybackSourceKind.MpegTs],
    ])('routes %s to the %s engine', (url, kind) => {
        expect(resolvePlaybackUrlSourceKind(url)).toBe(kind);
    });

    it.each([
        'https://example.test/movie/user/pass/2000000.mp4',
        'https://example.test/series/user/pass/80000.mkv',
        'https://example.test/movie.MKV?token=signed',
        'https://example.test/play?extension=mkv',
        'https://example.test/movie.webm',
        'https://example.test/movie.avi',
        'https://example.test/movie.mov',
        'https://example.test/movie.m4v',
        'https://example.test/track.mp3',
        'https://example.test/movie.bin',
    ])('hands the non-HLS container %s to the native element', (url) => {
        expect(resolvePlaybackUrlSourceKind(url)).toBe(
            PlaybackSourceKind.Native
        );
    });
});
