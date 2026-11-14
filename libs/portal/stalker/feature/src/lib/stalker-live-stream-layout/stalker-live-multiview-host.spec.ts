import { signal } from '@angular/core';
import type { MultiviewTile } from '@iptvnator/playback/multiview/data-access';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import {
    createStalkerLiveMultiviewHost,
    STALKER_LIVE_ANCHOR_ID,
} from './stalker-live-multiview-host';

const PLAYBACK: ResolvedPortalPlayback = {
    streamUrl: 'https://stalker.example/play/101?token=synthetic',
    title: 'Synthetic News',
    isLive: true,
};

function setup() {
    const deps = {
        identity: signal<{ sourceId: string; contentId: string } | null>({
            sourceId: 'portal-1',
            contentId: '101',
        }),
        playback: signal<ResolvedPortalPlayback | null>(PLAYBACK),
        sessionKey: signal('live|portal-1|101'),
        radio: signal(false),
        player: signal<VideoPlayer | undefined>(VideoPlayer.Html5Player),
        selectChannel: jest.fn(() => true),
    };
    return { deps, host: createStalkerLiveMultiviewHost(deps) };
}

function tile(overrides: Partial<MultiviewTile>): MultiviewTile {
    return {
        id: 'tile-2',
        playback: PLAYBACK,
        playbackSessionKey: 'live|portal-1|202',
        kind: 'live',
        playlistId: 'portal-1',
        contentId: '202',
        title: 'Synthetic Sport',
        engine: VideoPlayer.Html5Player,
        status: 'playing',
        lastPosition: 0,
        ...overrides,
    };
}

describe('createStalkerLiveMultiviewHost', () => {
    it('describes the playing channel as a live source', () => {
        const { host } = setup();

        expect(host.anchorId).toBe(STALKER_LIVE_ANCHOR_ID);
        expect(host.source()).toEqual({
            playback: PLAYBACK,
            playbackSessionKey: 'live|portal-1|101',
            kind: 'live',
            playlistId: 'portal-1',
            contentId: '101',
            title: 'Synthetic News',
        });
        expect(host.engine()).toBe(VideoPlayer.Html5Player);
    });

    it('carries the playing row for parental relocks (R11)', () => {
        const item = {
            uid: 'stalker::portal-1::101',
            name: 'Synthetic News',
            contentType: 'live',
            sourceType: 'stalker',
            playlistId: 'portal-1',
            playlistName: '',
            categoryId: '7',
        } as const;
        const host = createStalkerLiveMultiviewHost({
            ...setup().deps,
            lockItem: () => item,
        });

        expect(host.source()?.lockItem).toBe(item);
    });

    it('marks radio so it never becomes a tile', () => {
        const { deps, host } = setup();
        deps.radio.set(true);

        expect(host.source()?.radio).toBe(true);
    });

    it.each([
        ['no playback', 'playback', null],
        ['no identity', 'identity', null],
        ['no session key', 'sessionKey', ''],
    ] as const)('has no source with %s', (_label, key, value) => {
        const { deps, host } = setup();
        (deps[key] as ReturnType<typeof signal<unknown>>).set(value);

        expect(host.source()).toBeNull();
    });

    it('falls back to the default engine', () => {
        const { deps, host } = setup();
        deps.player.set(undefined);

        expect(host.engine()).toBe(VideoPlayer.VideoJs);
    });

    it('plays a surviving channel of the same portal again', () => {
        const { deps, host } = setup();
        expect(host.adopt?.(tile({}))).toBe(true);

        expect(deps.selectChannel).toHaveBeenCalledWith('202');
    });

    it('reports a survivor the view does not list as not adopted (D2)', () => {
        const { host, deps } = setup();
        deps.selectChannel.mockReturnValue(false);

        expect(host.adopt?.(tile({}))).toBe(false);
    });

    it.each([
        ['another portal', { playlistId: 'portal-2' }],
        ['no channel id', { contentId: undefined }],
    ])('leaves a survivor from %s alone', (_label, overrides) => {
        const { deps, host } = setup();
        expect(host.adopt?.(tile(overrides))).toBe(false);

        expect(deps.selectChannel).not.toHaveBeenCalled();
    });
});
