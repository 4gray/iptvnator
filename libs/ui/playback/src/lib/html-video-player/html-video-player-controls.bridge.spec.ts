import { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { HtmlVideoPlayerControlsBridge } from './html-video-player-controls.bridge';
import {
    createVideo,
    readMpegtsState,
} from './html-video-player-controls.spec-fixtures';

describe('HtmlVideoPlayerControlsBridge MPEG-TS duration', () => {
    it('prefers a finite positive video duration', () => {
        const state = readMpegtsState({
            duration: 120,
            seekableEnds: [115],
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(120);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(true);
    });

    it('falls back to the last finite positive seekable end', () => {
        const state = readMpegtsState({
            duration: Infinity,
            seekableEnds: [90, NaN, 115],
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(115);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(true);
    });

    it('scans seekable ranges backward past invalid ends', () => {
        const state = readMpegtsState({
            duration: Infinity,
            seekableEnds: [105, NaN, -1],
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(105);
    });

    it('falls back to the last finite positive buffered end', () => {
        const state = readMpegtsState({
            duration: Infinity,
            seekableEnds: [NaN],
            bufferedEnds: [80, NaN, 112],
        });

        expect(state.durationSeconds).toBe(112);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(true);
    });

    it('returns no corrected duration when ranges throw or are invalid', () => {
        const throwingState = readMpegtsState({
            duration: Infinity,
            seekableEnds: [115],
            bufferedEnds: [112],
            seekableThrows: true,
            bufferedThrows: true,
        });
        const invalidState = readMpegtsState({
            duration: Infinity,
            seekableEnds: [NaN, -1, 0],
            bufferedEnds: [Infinity, -1, 0],
        });

        expect(throwingState.durationSeconds).toBeNull();
        expect(invalidState.durationSeconds).toBeNull();
    });

    it('keeps non-live MPEG-TS non-seekable until a seekable range exists', () => {
        const state = readMpegtsState({
            duration: Infinity,
            bufferedEnds: [112],
        });

        expect(state.durationSeconds).toBe(112);
        expect(state.isLive).toBe(false);
        expect(state.canSeek).toBe(false);
    });

    it('uses only the authoritative live input for live classification', () => {
        const liveState = readMpegtsState(
            {
                duration: 120,
                seekableEnds: [115],
            },
            true
        );
        const vodState = readMpegtsState({
            duration: Infinity,
            seekableEnds: [115],
        });

        expect(liveState.isLive).toBe(true);
        expect(liveState.durationSeconds).toBeNull();
        expect(vodState.isLive).toBe(false);
        expect(vodState.durationSeconds).toBe(115);
    });
});

describe('HtmlVideoPlayerControlsBridge lifecycle', () => {
    it('attaches the adapter exactly once with engine accessors', () => {
        const video = createVideo({ duration: 90 });
        const adapter = new WebVideoControlsAdapter();
        const attachSpy = jest.spyOn(adapter, 'attach');
        const bridge = new HtmlVideoPlayerControlsBridge({
            video,
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });

        bridge.attach();
        bridge.attach();

        expect(attachSpy).toHaveBeenCalledTimes(1);
        expect(attachSpy).toHaveBeenCalledWith(
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
        bridge.destroy();
    });

    it('lets non-MPEG-TS sources fall back to the video duration', () => {
        const adapter = new WebVideoControlsAdapter();
        const bridge = new HtmlVideoPlayerControlsBridge({
            video: createVideo({ duration: 87, seekableEnds: [80] }),
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });

        bridge.attach();
        bridge.setSource({ kind: 'native' });

        expect(adapter.state().durationSeconds).toBe(87);
        bridge.destroy();
    });

    it('clears corrected source state and refreshes authoritative inputs', () => {
        let isLive = false;
        const adapter = new WebVideoControlsAdapter();
        const bridge = new HtmlVideoPlayerControlsBridge({
            video: createVideo({
                duration: Infinity,
                seekableEnds: [115],
            }),
            adapter,
            isLive: () => isLive,
            showCaptions: () => true,
        });

        bridge.attach();
        bridge.setSource({ kind: 'mpegts' });
        expect(adapter.state().durationSeconds).toBe(115);
        expect(adapter.state().isLive).toBe(false);

        isLive = true;
        bridge.refreshInputs();
        expect(adapter.state().isLive).toBe(true);
        expect(adapter.state().durationSeconds).toBeNull();

        isLive = false;
        bridge.clearSource();
        expect(adapter.state().isLive).toBe(false);
        expect(adapter.state().durationSeconds).toBeNull();
        bridge.destroy();
    });

    it('detaches the adapter exactly once when destroyed twice', () => {
        const adapter = new WebVideoControlsAdapter();
        const detachSpy = jest.spyOn(adapter, 'detach');
        const bridge = new HtmlVideoPlayerControlsBridge({
            video: createVideo(),
            adapter,
            isLive: () => false,
            showCaptions: () => true,
        });
        bridge.attach();
        detachSpy.mockClear();

        bridge.destroy();
        bridge.destroy();

        expect(detachSpy).toHaveBeenCalledTimes(1);
    });
});
