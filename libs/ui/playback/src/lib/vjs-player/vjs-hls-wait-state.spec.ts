import { HLS_WAIT_NOTICE_MS, VjsHlsWaitState } from './vjs-hls-wait-state';

describe('Video.js HLS wait notice', () => {
    let video: HTMLVideoElement;
    let state: VjsHlsWaitState;
    beforeEach(() => {
        jest.useFakeTimers();
        video = document.createElement('video');
        Object.defineProperties(video, {
            paused: { configurable: true, value: false },
            readyState: { configurable: true, value: 0 },
        });
        state = new VjsHlsWaitState();
    });
    afterEach(() => {
        state.clear();
        jest.useRealTimers();
    });
    const bind = () =>
        state.bind(video, { src: 'https://fixture.example/live.m3u8' });

    it('shows only after prolonged waiting and leaves the engine running', () => {
        const pause = jest.spyOn(video, 'pause');
        bind();
        video.dispatchEvent(new Event('waiting'));
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS - 1);
        expect(state.visible()).toBe(false);
        jest.advanceTimersByTime(1);
        expect(state.visible()).toBe(true);
        expect(pause).not.toHaveBeenCalled();
        video.dispatchEvent(new Event('playing'));
        expect(state.visible()).toBe(false);
    });
    it('clears on time progression after the source recovers', () => {
        bind();
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS);
        video.currentTime = 1;
        video.dispatchEvent(new Event('timeupdate'));
        expect(state.visible()).toBe(false);
    });
    it.each(['pause', 'error', 'ended'])('clears feedback on %s', (event) => {
        bind();
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS);
        video.dispatchEvent(new Event(event));
        expect(state.visible()).toBe(false);
    });
    it('does not warn for paused, buffered or non-HLS playback', () => {
        Object.defineProperty(video, 'paused', { value: true });
        bind();
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS);
        expect(state.visible()).toBe(false);
        Object.defineProperty(video, 'paused', { value: false });
        Object.defineProperty(video, 'readyState', { value: 4 });
        bind();
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS);
        expect(state.visible()).toBe(false);
        state.bind(video, { src: 'https://fixture.example/movie.webm' });
        Object.defineProperty(video, 'readyState', { value: 0 });
        video.dispatchEvent(new Event('waiting'));
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS);
        expect(state.visible()).toBe(false);
    });
    it('retires timers/listeners before source replacement or destruction', () => {
        bind();
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS - 1);
        state.clear();
        video.dispatchEvent(new Event('waiting'));
        jest.advanceTimersByTime(HLS_WAIT_NOTICE_MS);
        expect(state.visible()).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });
});
