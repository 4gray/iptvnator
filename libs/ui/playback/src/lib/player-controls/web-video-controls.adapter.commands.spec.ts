import { WebVideoControlsAdapter } from './web-video-controls.adapter';
import { DEFAULT_PLAYER_CAPABILITIES } from './player-controls-defaults';

/** jsdom `<video>` with overridable readonly media props (command-path spec). */
function createVideo(
    overrides: Partial<{
        duration: number;
        readyState: number;
        paused: boolean;
        ended: boolean;
        error: MediaError | null;
        seekableLength: number;
        muted: boolean;
        volume: number;
        currentTime: number;
        playbackRate: number;
        playRejects: boolean;
    }> = {}
): HTMLVideoElement {
    const video = document.createElement('video');
    const define = (prop: string, value: unknown) =>
        Object.defineProperty(video, prop, {
            configurable: true,
            writable: true,
            value,
        });
    define('duration', overrides.duration ?? NaN);
    define('readyState', overrides.readyState ?? 4);
    define('paused', overrides.paused ?? false);
    define('ended', overrides.ended ?? false);
    define('error', overrides.error ?? null);
    define('seekable', { length: overrides.seekableLength ?? 0 });
    define('muted', overrides.muted ?? false);
    define('volume', overrides.volume ?? 1);
    define('currentTime', overrides.currentTime ?? 0);
    define('playbackRate', overrides.playbackRate ?? 1);
    define(
        'play',
        overrides.playRejects
            ? jest.fn().mockRejectedValue(new Error('blocked'))
            : jest.fn().mockResolvedValue(undefined)
    );
    define('pause', jest.fn());
    return video;
}

describe('WebVideoControlsAdapter (commands & edge branches)', () => {
    let adapter: WebVideoControlsAdapter;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
    });

    afterEach(() => adapter.detach());

    it('pauses a playing video and resumes an ended one', () => {
        const playing = createVideo({ paused: false });
        adapter.attach(playing);
        adapter.commands.togglePlay();
        expect(playing.pause).toHaveBeenCalled();

        const ended = createVideo({ paused: false, ended: true });
        const endedAdapter = new WebVideoControlsAdapter();
        endedAdapter.attach(ended);
        endedAdapter.commands.togglePlay();
        expect(ended.play).toHaveBeenCalled();
        endedAdapter.detach();
    });

    it('swallows play() rejections (autoplay policies)', async () => {
        const video = createVideo({ paused: true, playRejects: true });
        adapter.attach(video);
        expect(() => adapter.commands.togglePlay()).not.toThrow();
        await Promise.resolve();
        expect(video.play).toHaveBeenCalled();
    });

    it('ignores every command while no video is attached', () => {
        expect(() => {
            adapter.commands.togglePlay();
            adapter.commands.seekTo(10);
            adapter.commands.seekBy(5);
            adapter.commands.setVolume(0.5);
            adapter.commands.setPlaybackSpeed(2);
            adapter.commands.setAudioTrack(1);
            adapter.commands.setSubtitleTrack(-1);
            adapter.commands.setAspectRatio('16:9');
            adapter.commands.toggleRecording();
        }).not.toThrow();
    });

    it('reports no capabilities before a video is attached', () => {
        expect(adapter.capabilities()).toEqual(DEFAULT_PLAYER_CAPABILITIES);
    });

    it('ignores track selection when the engine exposes no accessors', () => {
        adapter.attach(createVideo());
        expect(() => {
            adapter.commands.setAudioTrack(1);
            adapter.commands.setSubtitleTrack(0);
        }).not.toThrow();
    });

    it('rejects non-finite or non-positive playback speeds', () => {
        const video = createVideo({ playbackRate: 1 });
        adapter.attach(video);

        adapter.commands.setPlaybackSpeed(NaN);
        adapter.commands.setPlaybackSpeed(0);
        adapter.commands.setPlaybackSpeed(-1);
        expect(video.playbackRate).toBe(1);

        adapter.commands.setPlaybackSpeed(1.25);
        expect(video.playbackRate).toBe(1.25);
    });

    it('does not clamp seekTo when the duration is not finite', () => {
        const video = createVideo({ duration: Infinity });
        adapter.attach(video);
        adapter.commands.seekTo(1234);
        expect(video.currentTime).toBe(1234);
    });

    it('clamps setVolume into [0, 1] and mutes only at zero', () => {
        const video = createVideo();
        adapter.attach(video);

        adapter.commands.setVolume(1.5);
        expect(video.volume).toBe(1);
        expect(video.muted).toBe(false);

        adapter.commands.setVolume(-0.5);
        expect(video.volume).toBe(0);
        expect(video.muted).toBe(true);
    });

    it('detach is idempotent and re-attach rebinds listeners once', () => {
        const first = createVideo();
        const removeSpy = jest.spyOn(first, 'removeEventListener');
        adapter.attach(first);
        adapter.detach();
        adapter.detach();
        const callsAfterDoubleDetach = removeSpy.mock.calls.length;
        adapter.detach();
        expect(removeSpy.mock.calls.length).toBe(callsAfterDoubleDetach);

        // Attaching a new element detaches the previous one.
        const second = createVideo();
        adapter.attach(first);
        adapter.attach(second);
        expect(
            removeSpy.mock.calls.filter(([event]) => event === 'play').length
        ).toBeGreaterThanOrEqual(2);
    });

    it('invalidates cached state and capabilities after detach', () => {
        adapter.attach(createVideo({ duration: 120, volume: 0.4 }), {
            isLive: () => false,
        });
        expect(adapter.state().status).toBe('playing');
        expect(adapter.capabilities().seek).toBe(true);

        adapter.detach();

        const state = adapter.state();
        expect(state.status).toBe('idle');
        expect(state.volume).toBe(1);
        expect(state.positionSeconds).toBe(0);
        expect(state.canSeek).toBe(false);
        expect(adapter.capabilities()).toEqual(DEFAULT_PLAYER_CAPABILITIES);
    });

    it('clears engine callbacks on detach', () => {
        const setAudioTrack = jest.fn();
        adapter.attach(createVideo(), { setAudioTrack });
        adapter.detach();

        adapter.commands.setAudioTrack(1);

        expect(setAudioTrack).not.toHaveBeenCalled();
    });

    it('treats a throwing seekable getter as not seekable', () => {
        const video = createVideo({ duration: 100 });
        Object.defineProperty(video, 'seekable', {
            configurable: true,
            get() {
                throw new Error('not supported');
            },
        });
        adapter.attach(video, { isLive: () => false });
        expect(adapter.state().canSeek).toBe(false);
    });

    it('maps warming-up videos to loading (paused and playing variants)', () => {
        const pausedWarmup = createVideo({ paused: true, readyState: 1 });
        adapter.attach(pausedWarmup);
        expect(adapter.state().status).toBe('loading');

        const playingWarmup = createVideo({ paused: false, readyState: 2 });
        const other = new WebVideoControlsAdapter();
        other.attach(playingWarmup);
        expect(other.state().status).toBe('loading');
        other.detach();
    });

    it('falls back to finite element duration for liveness when isLive is omitted', () => {
        adapter.attach(createVideo({ duration: 42, seekableLength: 1 }));
        expect(adapter.state().isLive).toBe(false);
        expect(adapter.state().durationSeconds).toBe(42);
    });

    it('normalizes a zero duration to null', () => {
        adapter.attach(createVideo({ duration: 0 }), { isLive: () => false });
        expect(adapter.state().durationSeconds).toBeNull();
        expect(adapter.state().canSeek).toBe(false);
    });
});
