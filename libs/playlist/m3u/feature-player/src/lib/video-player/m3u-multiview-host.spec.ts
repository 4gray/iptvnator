import { signal } from '@angular/core';
import type { MultiviewTile } from '@iptvnator/playback/multiview/data-access';
import {
    type Channel,
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    createM3uMultiviewHost,
    M3U_PLAYER_ANCHOR_ID,
} from './m3u-multiview-host';

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://m3u.example/live/news.m3u8',
    title: 'Synthetic News',
    isLive: true,
};

function setup() {
    const deps = {
        playlistId: signal<string | null>('playlist-1'),
        channel: signal<Channel | null>({ id: 'ch-1' } as Channel),
        playback: signal<ResolvedPortalPlayback | null>(PLAYBACK),
        sessionKey: signal('live|playlist-1|ch-1'),
        catchupUrl: signal<string | null>(null),
        engine: signal<VideoPlayer | null>(VideoPlayer.Html5Player),
        selectChannel: jest.fn(() => true),
    };
    return { deps, host: createM3uMultiviewHost(deps) };
}

function tile(overrides: Partial<MultiviewTile>): MultiviewTile {
    return {
        id: 'tile-2',
        playback: PLAYBACK,
        playbackSessionKey: 'live|playlist-1|ch-2',
        kind: 'live',
        playlistId: 'playlist-1',
        contentId: 'ch-2',
        title: 'Synthetic Sport',
        engine: VideoPlayer.Html5Player,
        status: 'playing',
        lastPosition: 0,
        ...overrides,
    };
}

describe('createM3uMultiviewHost', () => {
    it('describes the playing channel', () => {
        const { host } = setup();

        expect(host.anchorId).toBe(M3U_PLAYER_ANCHOR_ID);
        expect(host.source()).toEqual({
            playback: PLAYBACK,
            playbackSessionKey: 'live|playlist-1|ch-1',
            kind: 'live',
            playlistId: 'playlist-1',
            contentId: 'ch-1',
            title: 'Synthetic News',
            // What a parental relock checks once the view moved on (R11).
            lockItem: expect.objectContaining({
                sourceType: 'm3u',
                contentType: 'live',
                playlistId: 'playlist-1',
                m3uChannel: { id: 'ch-1' },
            }),
        });
        expect(host.engine()).toBe(VideoPlayer.Html5Player);
    });

    it('treats a movie file as VOD', () => {
        const { deps, host } = setup();
        deps.playback.set({ ...PLAYBACK, isLive: false });

        expect(host.source()?.kind).toBe('vod');
    });

    it('marks a radio channel so it never becomes a tile', () => {
        const { deps, host } = setup();
        deps.channel.set({ id: 'ch-1', radio: 'true' } as Channel);

        expect(host.source()?.radio).toBe(true);
    });

    it('treats a catch-up programme as its own VOD source', () => {
        const { deps, host } = setup();
        deps.catchupUrl.set('https://m3u.example/archive/news?utc=1');
        deps.playback.set({ ...PLAYBACK, isLive: false });

        expect(host.source()).toMatchObject({
            kind: 'vod',
            playbackSessionKey:
                'live|playlist-1|ch-1|catchup:https://m3u.example/archive/news?utc=1',
            contentId: undefined,
        });
    });

    it.each([
        ['no playback', 'playback', null],
        ['no session key', 'sessionKey', ''],
        ['no playlist', 'playlistId', null],
        ['no channel', 'channel', null],
    ] as const)('has no source with %s', (_label, key, value) => {
        const { deps, host } = setup();
        (deps[key] as ReturnType<typeof signal<unknown>>).set(value);

        expect(host.source()).toBeNull();
    });

    it('falls back to the default engine', () => {
        const { deps, host } = setup();
        deps.engine.set(null);

        expect(host.engine()).toBe(VideoPlayer.VideoJs);
    });

    it('selects a surviving channel of the same playlist', () => {
        const { deps, host } = setup();
        expect(host.adopt?.(tile({}))).toBe(true);

        expect(deps.selectChannel).toHaveBeenCalledWith('ch-2');
    });

    it('reports a survivor the view does not list as not adopted (D2)', () => {
        const { host, deps } = setup();
        deps.selectChannel.mockReturnValue(false);

        expect(host.adopt?.(tile({}))).toBe(false);
    });

    it.each([
        ['another playlist', { playlistId: 'playlist-2' }],
        ['a catch-up programme', { contentId: undefined }],
    ])('leaves a survivor from %s alone', (_label, overrides) => {
        const { deps, host } = setup();
        expect(host.adopt?.(tile(overrides))).toBe(false);

        expect(deps.selectChannel).not.toHaveBeenCalled();
    });
});
