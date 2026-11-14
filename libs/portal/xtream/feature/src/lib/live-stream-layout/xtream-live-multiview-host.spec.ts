import { signal } from '@angular/core';
import type { MultiviewTile } from '@iptvnator/playback/multiview/data-access';
import {
    type EpgProgram,
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    createXtreamLiveMultiviewHost,
    XTREAM_LIVE_ANCHOR_ID,
} from './xtream-live-multiview-host';

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://xtream.example/live/user/pass/101.m3u8',
    title: 'Synthetic News',
    isLive: true,
};

function setup() {
    const deps = {
        playlistId: signal<string | undefined>('playlist-1'),
        playback: signal<ResolvedPortalPlayback | null>(PLAYBACK),
        sessionKey: signal('live|playlist-1|101'),
        channelId: signal<number | null>(101),
        catchupProgram: signal<EpgProgram | null>(null),
        player: signal<VideoPlayer | undefined>(VideoPlayer.ArtPlayer),
        selectChannel: jest.fn(() => true),
    };
    return { deps, host: createXtreamLiveMultiviewHost(deps) };
}

function tile(overrides: Partial<MultiviewTile>): MultiviewTile {
    return {
        id: 'tile-2',
        playback: PLAYBACK,
        playbackSessionKey: 'live|playlist-1|202',
        kind: 'live',
        playlistId: 'playlist-1',
        contentId: '202',
        title: 'Synthetic Sport',
        engine: VideoPlayer.Html5Player,
        status: 'playing',
        lastPosition: 0,
        ...overrides,
    };
}

describe('createXtreamLiveMultiviewHost', () => {
    it('describes the playing channel as a live source', () => {
        const { host } = setup();

        expect(host.anchorId).toBe(XTREAM_LIVE_ANCHOR_ID);
        expect(host.source()).toEqual({
            playback: PLAYBACK,
            playbackSessionKey: 'live|playlist-1|101',
            kind: 'live',
            playlistId: 'playlist-1',
            contentId: '101',
            title: 'Synthetic News',
            // What a parental relock checks once the view moved on (R11).
            lockItem: expect.objectContaining({
                sourceType: 'xtream',
                contentType: 'live',
                playlistId: 'playlist-1',
                xtreamId: 101,
            }),
        });
        expect(host.engine()).toBe(VideoPlayer.ArtPlayer);
    });

    it('treats a catch-up programme as its own VOD-like source', () => {
        const { deps, host } = setup();
        deps.catchupProgram.set({
            start: '2026-11-12T20:00:00.000Z',
            stop: '2026-11-12T21:00:00.000Z',
            channel: '101',
            title: 'Synthetic Evening',
            desc: null,
            category: null,
        });

        expect(host.source()).toMatchObject({
            kind: 'vod',
            playbackSessionKey:
                'live|playlist-1|101|catchup:2026-11-12T20:00:00.000Z',
        });
    });

    it.each([
        ['no playback', { playback: null }],
        ['no session key', { sessionKey: '' }],
        ['no playlist', { playlistId: undefined }],
    ])('has no source with %s', (_label, change) => {
        const { deps, host } = setup();
        for (const [key, value] of Object.entries(change)) {
            (deps[key as keyof typeof deps] as ReturnType<typeof signal>).set(
                value
            );
        }

        expect(host.source()).toBeNull();
    });

    it('falls back to the default engine', () => {
        const { deps, host } = setup();
        deps.player.set(undefined);

        expect(host.engine()).toBe(VideoPlayer.VideoJs);
    });

    it('selects a surviving channel of the same playlist', () => {
        const { deps, host } = setup();
        expect(host.adopt?.(tile({}))).toBe(true);

        expect(deps.selectChannel).toHaveBeenCalledWith(202);
    });

    it('reports a survivor the view does not list as not adopted (D2)', () => {
        const { host, deps } = setup();
        deps.selectChannel.mockReturnValue(false);

        expect(host.adopt?.(tile({}))).toBe(false);
    });

    it.each([
        ['another playlist', { playlistId: 'playlist-2' }],
        ['a catch-up programme', { kind: 'vod' as const }],
        ['no channel id', { contentId: undefined }],
    ])('leaves a survivor from %s alone', (_label, overrides) => {
        const { deps, host } = setup();
        expect(host.adopt?.(tile(overrides))).toBe(false);

        expect(deps.selectChannel).not.toHaveBeenCalled();
    });
});
