import { getPlaybackMediaExtensionFromUrl } from './playback-media-extension.util';

describe('getPlaybackMediaExtensionFromUrl', () => {
    it('reads the path extension of a URL without a query', () => {
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://provider.example/series/u/p/12.mp4'
            )
        ).toBe('mp4');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://provider.example/live/u/p/7.ts#t=10'
            )
        ).toBe('ts');
    });

    it('lets a declared query extension win over the path', () => {
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://provider.example/play.php?id=1&extension=m3u8'
            )
        ).toBe('m3u8');
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://provider.example/stream?format=mpegts'
            )
        ).toBe('ts');
    });

    it('ignores a question mark that sits inside the fragment', () => {
        expect(
            getPlaybackMediaExtensionFromUrl(
                'http://provider.example/movie/u/p/3.mkv#x?extension=m3u8'
            )
        ).toBe('mkv');
    });

    it('returns no extension for a script path without a declared format', () => {
        expect(
            getPlaybackMediaExtensionFromUrl('http://provider.example/get.php')
        ).toBe('');
    });
});
