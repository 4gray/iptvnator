import { signal } from '@angular/core';
import type { PlayerTrack } from './player-controls.model';
import { WebVideoControlsAdapter } from './web-video-controls.adapter';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';

/**
 * Builds a jsdom `<video>` whose readonly media props (duration, readyState,
 * paused, ended, error, seekable) can be overridden per-test.
 */
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
    define('play', jest.fn().mockResolvedValue(undefined));
    define('pause', jest.fn());
    return video;
}

describe('WebVideoControlsAdapter', () => {
    let adapter: WebVideoControlsAdapter;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
    });

    afterEach(() => adapter.detach());

    it('maps a playing VOD video to state with seek + finite duration', () => {
        const video = createVideo({
            duration: 120,
            seekableLength: 1,
            currentTime: 30,
            volume: 0.6,
        });
        adapter.attach(video, { isLive: () => false });

        const state = adapter.state();
        expect(state.status).toBe('playing');
        expect(state.positionSeconds).toBe(30);
        expect(state.durationSeconds).toBe(120);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(true);
        expect(state.volume).toBe(0.6);
    });

    it('reports a paused video and a muted volume of 0', () => {
        const video = createVideo({ paused: true, muted: true, volume: 0.8 });
        adapter.attach(video, { isLive: () => false });

        const state = adapter.state();
        expect(state.status).toBe('paused');
        expect(state.volume).toBe(0);
    });

    it('treats infinite-duration sources as live with no seek', () => {
        const video = createVideo({ duration: Infinity });
        adapter.attach(video);

        const state = adapter.state();
        expect(state.isLive).toBe(true);
        expect(state.durationSeconds).toBeNull();
        expect(state.canSeek).toBe(false);
    });

    it('prefers getDuration over the element duration (raw-TS VOD)', () => {
        // mpegts VOD: <video>.duration stays Infinity, real duration on player.
        const video = createVideo({ duration: Infinity, seekableLength: 1 });
        adapter.attach(video, { getDuration: () => 164.072 });

        const state = adapter.state();
        expect(state.isLive).toBe(false);
        expect(state.durationSeconds).toBe(164.072);
        expect(state.canSeek).toBe(true);
    });

    it('falls back to the element duration when getDuration is not finite', () => {
        const video = createVideo({ duration: 90, seekableLength: 1 });
        adapter.attach(video, { getDuration: () => NaN });

        const state = adapter.state();
        expect(state.isLive).toBe(false);
        expect(state.durationSeconds).toBe(90);
    });

    it('is not stalled when paused with partial data, but stalls while buffering', () => {
        const paused = createVideo({
            paused: true,
            readyState: 2,
            duration: 120,
        });
        adapter.attach(paused, { isLive: () => false });
        expect(adapter.state().stalled).toBe(false);

        const buffering = createVideo({
            paused: false,
            ended: false,
            readyState: 2,
            duration: 120,
        });
        const bufferingAdapter = new WebVideoControlsAdapter();
        bufferingAdapter.attach(buffering, { isLive: () => false });
        expect(bufferingAdapter.state().stalled).toBe(true);
        bufferingAdapter.detach();
    });

    it('maps error and ended status from the video element', () => {
        const errorVideo = createVideo({
            error: { code: 4 } as MediaError,
        });
        adapter.attach(errorVideo);
        expect(adapter.state().status).toBe('error');

        const endedAdapter = new WebVideoControlsAdapter();
        endedAdapter.attach(createVideo({ ended: true }));
        expect(endedAdapter.state().status).toBe('ended');
        endedAdapter.detach();
    });

    it('recomputes state when media events fire', () => {
        const video = createVideo({ paused: true });
        adapter.attach(video, { isLive: () => false });
        expect(adapter.state().status).toBe('paused');

        Object.defineProperty(video, 'paused', {
            configurable: true,
            value: false,
        });
        video.dispatchEvent(new Event('play'));
        expect(adapter.state().status).toBe('playing');
    });

    it('delegates play/pause/seek/volume/speed commands to the element', () => {
        const video = createVideo({ duration: 100, paused: true });
        adapter.attach(video, { isLive: () => false });

        adapter.commands.togglePlay();
        expect(video.play).toHaveBeenCalled();

        adapter.commands.seekTo(42);
        expect(video.currentTime).toBe(42);

        adapter.commands.seekBy(10);
        expect(video.currentTime).toBe(52);

        adapter.commands.setVolume(0.25);
        expect(video.volume).toBe(0.25);
        expect(video.muted).toBe(false);

        adapter.commands.setVolume(0);
        expect(video.muted).toBe(true);

        adapter.commands.setPlaybackSpeed(1.5);
        expect(video.playbackRate).toBe(1.5);
    });

    it('clamps seekTo to the finite duration', () => {
        const video = createVideo({ duration: 60 });
        adapter.attach(video, { isLive: () => false });

        adapter.commands.seekTo(999);
        expect(video.currentTime).toBe(60);
        adapter.commands.seekTo(-5);
        expect(video.currentTime).toBe(0);
    });

    it('gates capabilities: recording always false, aspectRatio false', () => {
        adapter.attach(createVideo({ duration: 100 }), {
            isLive: () => false,
        });
        const caps = adapter.capabilities();
        expect(caps.recording).toBe(false);
        expect(caps.aspectRatio).toBe(false);
        expect(caps.seek).toBe(true);
        expect(caps.volume).toBe(true);
        expect(caps.playbackSpeed).toBe(true);
        expect(caps.fullscreen).toBe(true);
    });

    it('enables audioTracks only when more than one track is exposed', () => {
        const single: PlayerTrack[] = [
            { id: 0, label: 'EN', selected: true },
        ];
        const multi: PlayerTrack[] = [
            { id: 0, label: 'EN', selected: true },
            { id: 1, label: 'DE', selected: false },
        ];

        adapter.attach(createVideo(), { getAudioTracks: () => single });
        expect(adapter.capabilities().audioTracks).toBe(false);

        const multiAdapter = new WebVideoControlsAdapter();
        multiAdapter.attach(createVideo(), { getAudioTracks: () => multi });
        expect(multiAdapter.capabilities().audioTracks).toBe(true);
        expect(multiAdapter.state().audioTracks).toEqual(multi);
        multiAdapter.detach();
    });

    it('enables subtitles when any subtitle track is present', () => {
        const subtitles: PlayerTrack[] = [
            { id: 0, label: 'EN', selected: true },
        ];
        adapter.attach(createVideo(), {
            getSubtitleTracks: () => subtitles,
        });
        expect(adapter.capabilities().subtitles).toBe(true);
        expect(adapter.state().subtitlesEnabled).toBe(true);
    });

    it('routes track selection commands to the injected accessors', () => {
        const setAudioTrack = jest.fn();
        const setSubtitleTrack = jest.fn();
        adapter.attach(createVideo(), { setAudioTrack, setSubtitleTrack });

        adapter.commands.setAudioTrack(2);
        adapter.commands.setSubtitleTrack(-1);
        expect(setAudioTrack).toHaveBeenCalledWith(2);
        expect(setSubtitleTrack).toHaveBeenCalledWith(-1);
    });

    it('gates series navigation on context + VOD', () => {
        const nav = signal<SeriesPlaybackNavigation | null>({
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        const video = createVideo({ duration: 100 });
        adapter.attach(video, { isLive: () => false });
        adapter.setContext({ seriesNavigation: nav });

        expect(adapter.capabilities().seriesNavigation).toBe(true);
        expect(adapter.state().canPreviousEpisode).toBe(true);
        expect(adapter.state().canNextEpisode).toBe(false);
    });

    it('reflects host series-navigation signal updates made AFTER setContext', () => {
        const nav = signal<SeriesPlaybackNavigation | null>({
            canPrevious: false,
            canNext: false,
            autoplayEnabled: true,
        });
        const video = createVideo({ duration: 100 });
        adapter.attach(video, { isLive: () => false });
        adapter.setContext({ seriesNavigation: nav });

        expect(adapter.state().canPreviousEpisode).toBe(false);
        expect(adapter.state().canNextEpisode).toBe(false);

        // Host pushes an update to the SAME signal after setContext.
        nav.set({ canPrevious: true, canNext: true, autoplayEnabled: true });

        expect(adapter.capabilities().seriesNavigation).toBe(true);
        expect(adapter.state().canPreviousEpisode).toBe(true);
        expect(adapter.state().canNextEpisode).toBe(true);

        // Clearing the navigation reactively disables the capability.
        nav.set(null);
        expect(adapter.capabilities().seriesNavigation).toBe(false);
    });

    it('disables series navigation for live streams', () => {
        const nav = signal<SeriesPlaybackNavigation | null>({
            canPrevious: true,
            canNext: true,
            autoplayEnabled: true,
        });
        adapter.attach(createVideo({ duration: Infinity }), {
            isLive: () => true,
        });
        adapter.setContext({ seriesNavigation: nav });

        expect(adapter.capabilities().seriesNavigation).toBe(false);
        expect(adapter.state().canPreviousEpisode).toBe(false);
        expect(adapter.state().canNextEpisode).toBe(false);
    });

    it('removes listeners on detach', () => {
        const video = createVideo();
        const removeSpy = jest.spyOn(video, 'removeEventListener');
        adapter.attach(video);
        adapter.detach();
        expect(removeSpy).toHaveBeenCalledWith('play', expect.any(Function));
        expect(removeSpy).toHaveBeenCalledWith(
            'timeupdate',
            expect.any(Function)
        );
    });
});
