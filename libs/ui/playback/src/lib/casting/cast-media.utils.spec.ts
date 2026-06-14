import { hasPlaybackHeaders } from '@iptvnator/shared/interfaces';
import {
    findCastMediaElement,
    getCastMediaType,
    getSafeCastThumbnailUrl,
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
        'http://localhost:4200/live.m3u8',
        'http://dev.localhost:4200/live.m3u8',
        'http://0.0.0.0:8080/live.m3u8',
        'http://127.0.0.1:8080/live.m3u8',
        'http://[::1]:8080/live.m3u8',
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
                requiresRequestHeaders: true,
            })
        ).toBe(true);
        expect(
            hasPlaybackHeaders({
                streamUrl: 'https://example.com/live.m3u8',
                title: 'Live',
            })
        ).toBe(false);
    });

    it('only forwards same-origin receiver-fetchable artwork', () => {
        expect(
            getSafeCastThumbnailUrl({
                streamUrl: 'https://example.com/live.m3u8',
                title: 'Live',
                thumbnail: 'https://example.com/logo.png',
            })
        ).toBe('https://example.com/logo.png');
        expect(
            getSafeCastThumbnailUrl({
                streamUrl: 'https://example.com/live.m3u8',
                title: 'Live',
                thumbnail: 'http://127.0.0.1/admin.png',
            })
        ).toBeUndefined();
        expect(
            getSafeCastThumbnailUrl({
                streamUrl: 'https://example.com/live.m3u8',
                title: 'Live',
                thumbnail: 'https://cdn.example.net/logo.png',
            })
        ).toBeUndefined();
    });

    it.each([
        ['https://example.com/live.m3u8', 'application/x-mpegURL'],
        ['https://example.com/channel.ts', 'video/mp2t'],
        ['https://example.com/movie.mp4', 'video/mp4'],
        ['https://example.com/radio.mp3', 'audio/mpeg'],
        ['https://example.com/audio.aac', 'audio/aac'],
        ['https://example.com/live/user/pass/42', 'video/mp2t'],
        [
            'https://example.com/play?extension=m3u8&token=signed',
            'application/x-mpegURL',
        ],
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
