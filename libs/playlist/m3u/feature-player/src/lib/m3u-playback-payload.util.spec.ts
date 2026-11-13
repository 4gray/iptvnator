import { Channel, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { buildM3uPlaybackPayload } from './m3u-playback-payload.util';

const row = (http: Partial<Channel['http']> = {}) =>
    ({
        id: 'row-1',
        name: ' Sandline ',
        url: 'http://h.example/movie/u/p/1.mkv',
        tvg: { name: 'Sandline tvg', logo: 'http://h.example/sandline.png' },
        http,
    }) as unknown as Channel;

describe('buildM3uPlaybackPayload', () => {
    it('carries the row’s own referer and origin as request headers', () => {
        const channel = row({
            referrer: 'http://portal.example/watch',
            origin: 'http://portal.example',
        });

        const payload = buildM3uPlaybackPayload({
            channel,
            target: channel,
            playlistMeta: null,
            isLive: false,
            startTime: 90,
        });

        expect(payload.headers).toEqual({
            Referer: 'http://portal.example/watch',
            Origin: 'http://portal.example',
        });
        expect(payload.referer).toBe('http://portal.example/watch');
        expect(payload.origin).toBe('http://portal.example');
        expect(payload.userAgent).toBeUndefined();
        expect(payload.startTime).toBe(90);
        expect(payload.title).toBe('Sandline');
    });

    it('fills the gaps from the playlist while the row’s values win', () => {
        const channel = row({ referrer: 'http://row.example/' });

        const payload = buildM3uPlaybackPayload({
            channel,
            target: channel,
            playlistMeta: {
                userAgent: 'ExampleAgent/1.0',
                referrer: 'http://playlist.example/',
                origin: 'http://playlist.example',
            } as PlaylistMeta,
            isLive: true,
        });

        expect(payload.headers).toEqual({
            'User-Agent': 'ExampleAgent/1.0',
            Referer: 'http://row.example/',
            Origin: 'http://playlist.example',
        });
        expect(payload.isLive).toBe(true);
    });

    it('sends no header block when neither the row nor the playlist sets one', () => {
        const channel = row();

        const payload = buildM3uPlaybackPayload({
            channel,
            target: { ...channel, epgParams: '?utc=1' },
            playlistMeta: undefined,
            isLive: true,
        });

        expect(payload.headers).toBeUndefined();
        expect(payload.referer).toBeUndefined();
        expect(payload.origin).toBeUndefined();
        expect(payload.streamUrl).toBe(
            'http://h.example/movie/u/p/1.mkv?utc=1'
        );
        expect(payload.thumbnail).toBe('http://h.example/sandline.png');
    });
});
