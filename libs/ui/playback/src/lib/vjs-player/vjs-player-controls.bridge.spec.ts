import type { WebVideoControlsOptions } from '../player-controls/web-video-controls.adapter';
import type {
    VideoJsAudioTrack,
    VideoJsAudioTrackList,
    VideoJsPlayer,
    VideoJsTextTrack,
    VideoJsTextTrackList,
} from './vjs-player.types';
import { VjsPlayerControlsBridge } from './vjs-player-controls.bridge';

describe('VjsPlayerControlsBridge', () => {
    it('attaches the current Tech video with live, duration, and track accessors', () => {
        const audioTracks = createTrackList<VideoJsAudioTrack>([
            { label: 'English', enabled: true },
            { label: 'Deutsch', enabled: false },
        ]);
        const textTracks = createTrackList<VideoJsTextTrack>([
            { label: 'English CC', kind: 'captions', mode: 'showing' },
        ]);
        const player = createPlayer(audioTracks, textTracks, 91);
        const adapter = createAdapter();
        const bridge = new VjsPlayerControlsBridge({
            player,
            adapter: adapter.value,
            isLive: () => false,
            showCaptions: () => true,
        });
        const video = document.createElement('video');

        bridge.attach(video);
        bridge.setSource();

        expect(adapter.attach).toHaveBeenCalledWith(
            video,
            expect.objectContaining({
                isLive: expect.any(Function),
                getDuration: expect.any(Function),
                getAudioTracks: expect.any(Function),
                setAudioTrack: expect.any(Function),
                getSubtitleTracks: expect.any(Function),
                setSubtitleTrack: expect.any(Function),
            })
        );
        expect(adapter.options?.isLive?.()).toBe(false);
        expect(adapter.options?.getDuration?.()).toBe(91);
        expect(adapter.options?.getAudioTracks?.()).toEqual([
            { id: 0, label: 'English', selected: true },
            { id: 1, label: 'Deutsch', selected: false },
        ]);
        expect(adapter.options?.getSubtitleTracks?.()).toEqual([
            { id: 0, label: 'English CC', selected: true },
        ]);

        adapter.options?.setAudioTrack?.(1);
        adapter.options?.setSubtitleTrack?.(-1);

        expect(audioTracks[0].enabled).toBe(false);
        expect(audioTracks[1].enabled).toBe(true);
        expect(textTracks[0].mode).toBe('disabled');
    });

    it('reattaches only when Video.js replaces the Tech video', () => {
        const adapter = createAdapter();
        const bridge = new VjsPlayerControlsBridge({
            player: createPlayer(),
            adapter: adapter.value,
            isLive: () => true,
            showCaptions: () => false,
        });
        const firstVideo = document.createElement('video');
        const secondVideo = document.createElement('video');

        bridge.attach(firstVideo);
        bridge.rebind(firstVideo);
        bridge.rebind(secondVideo);

        expect(adapter.attach).toHaveBeenCalledTimes(2);
        expect(adapter.attach).toHaveBeenNthCalledWith(
            1,
            firstVideo,
            expect.any(Object)
        );
        expect(adapter.attach).toHaveBeenNthCalledWith(
            2,
            secondVideo,
            expect.any(Object)
        );
    });

    it('suppresses and restores the engine-selected subtitle from input changes', () => {
        let showCaptions = false;
        const textTracks = createTrackList<VideoJsTextTrack>([
            { label: 'English CC', kind: 'captions', mode: 'showing' },
        ]);
        const adapter = createAdapter();
        const bridge = new VjsPlayerControlsBridge({
            player: createPlayer(undefined, textTracks),
            adapter: adapter.value,
            isLive: () => false,
            showCaptions: () => showCaptions,
        });

        bridge.attach(document.createElement('video'));
        bridge.setSource();
        expect(textTracks[0].mode).toBe('disabled');

        showCaptions = true;
        bridge.refreshInputs();

        expect(textTracks[0].mode).toBe('showing');
        expect(adapter.refresh).toHaveBeenCalled();
    });

    it('clears source-owned tracks and tears down idempotently', () => {
        const audioTracks = createTrackList<VideoJsAudioTrack>([
            { label: 'English', enabled: true },
            { label: 'Deutsch', enabled: false },
        ]);
        const adapter = createAdapter();
        const bridge = new VjsPlayerControlsBridge({
            player: createPlayer(audioTracks),
            adapter: adapter.value,
            isLive: () => true,
            showCaptions: () => false,
        });

        bridge.attach(document.createElement('video'));
        bridge.setSource();
        expect(adapter.options?.getAudioTracks?.()).toHaveLength(2);

        bridge.clearSource();
        expect(adapter.options?.getAudioTracks?.()).toEqual([]);

        bridge.destroy();
        bridge.destroy();
        bridge.attach(document.createElement('video'));

        expect(adapter.detach).toHaveBeenCalledTimes(1);
        expect(adapter.attach).toHaveBeenCalledTimes(1);
    });
});

function createAdapter() {
    const adapter: {
        options?: WebVideoControlsOptions;
        attach: jest.Mock;
        detach: jest.Mock;
        refresh: jest.Mock;
    } = {
        attach: jest.fn((_video, options: WebVideoControlsOptions) => {
            adapter.options = options;
        }),
        detach: jest.fn(),
        refresh: jest.fn(),
    };
    return {
        get options() {
            return adapter.options;
        },
        attach: adapter.attach,
        detach: adapter.detach,
        refresh: adapter.refresh,
        value: adapter as unknown as import('../player-controls/web-video-controls.adapter').WebVideoControlsAdapter,
    };
}

function createPlayer(
    audioTracks = createTrackList<VideoJsAudioTrack>([]),
    textTracks = createTrackList<VideoJsTextTrack>([]),
    duration = 0
): VideoJsPlayer {
    return {
        audioTracks: jest.fn(() => audioTracks),
        textTracks: jest.fn(() => textTracks),
        duration: jest.fn(() => duration),
        getChild: jest.fn(() => null),
        tech: jest.fn(() => null),
    } as unknown as VideoJsPlayer;
}

function createTrackList<TTrack extends object>(
    tracks: TTrack[]
): (TTrack[] & {
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
}) &
    (TTrack extends VideoJsAudioTrack
        ? VideoJsAudioTrackList
        : VideoJsTextTrackList) {
    return Object.assign(tracks, {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    }) as never;
}
