import {
    findCastMediaElement,
    getCastMediaType,
    hasPlaybackHeaders,
    isDirectCastUrl,
} from './cast-media.utils';

describe('cast media utilities', () => {
    it.each([
        'https://example.com/live/channel.m3u8',
        'http://192.168.1.20/media/movie.mp4',
    ])('accepts receiver-fetchable HTTP media URLs', (url) => {
        expect(isDirectCastUrl(url)).toBe(true);
    });

    it.each([
        'blob:https://example.com/stream',
        'file:///tmp/movie.mp4',
        'data:video/mp4;base64,AAAA',
        'not a URL',
    ])('rejects URLs a remote receiver cannot fetch', (url) => {
        expect(isDirectCastUrl(url)).toBe(false);
    });

    it('detects provider headers that remote receivers cannot inherit', () => {
        expect(
            hasPlaybackHeaders({
                streamUrl: 'https://example.com/live.m3u8',
                title: 'Live',
                headers: { Referer: 'https://provider.example' },
            })
        ).toBe(true);
        expect(
            hasPlaybackHeaders({
                streamUrl: 'https://example.com/live.m3u8',
                title: 'Live',
            })
        ).toBe(false);
    });

    it.each([
        ['https://example.com/live.m3u8', 'application/x-mpegURL'],
        ['https://example.com/channel.ts', 'video/mp2t'],
        ['https://example.com/movie.mp4', 'video/mp4'],
        ['https://example.com/radio.mp3', 'audio/mpeg'],
        ['https://example.com/audio.aac', 'audio/aac'],
    ])('infers a receiver media type for %s', (url, mediaType) => {
        expect(getCastMediaType(url)).toBe(mediaType);
    });

    it('finds media inside either video or radio player hosts', () => {
        const videoHost = document.createElement('div');
        videoHost.className = 'web-player-view';
        const videoControl = document.createElement('app-cast-control');
        const video = document.createElement('video');
        videoHost.append(video, videoControl);

        const radioHost = document.createElement('div');
        radioHost.className = 'radio-hero';
        const radioControl = document.createElement('app-cast-control');
        const audio = document.createElement('audio');
        radioHost.append(radioControl, audio);

        expect(findCastMediaElement(videoControl)).toBe(video);
        expect(findCastMediaElement(radioControl)).toBe(audio);
    });
});
