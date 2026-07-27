import { EmbeddedMpvStalledTracker } from './embedded-mpv-stalled-tracker';

describe('EmbeddedMpvStalledTracker', () => {
    let tracker: EmbeddedMpvStalledTracker;

    beforeEach(() => {
        jest.useFakeTimers();
        tracker = new EmbeddedMpvStalledTracker();
    });

    afterEach(() => {
        tracker.cancel();
        jest.useRealTimers();
    });

    it('flags a stall when loading exceeds the timeout', () => {
        tracker.track('loading');
        expect(tracker.stalled()).toBe(false);

        jest.advanceTimersByTime(29_999);
        expect(tracker.stalled()).toBe(false);

        jest.advanceTimersByTime(1);
        expect(tracker.stalled()).toBe(true);
    });

    it('keeps a single timer across repeated loading snapshots', () => {
        tracker.track('loading');
        jest.advanceTimersByTime(20_000);
        // Position-poll snapshots re-report 'loading' — must not restart timer.
        tracker.track('loading');
        jest.advanceTimersByTime(10_000);
        expect(tracker.stalled()).toBe(true);
    });

    it('cancels the pending timer when playback starts', () => {
        tracker.track('loading');
        tracker.track('playing');

        jest.advanceTimersByTime(60_000);
        expect(tracker.stalled()).toBe(false);
    });

    it('clears an already-raised stall on any non-loading status', () => {
        tracker.track('loading');
        jest.advanceTimersByTime(30_000);
        expect(tracker.stalled()).toBe(true);

        tracker.track('error');
        expect(tracker.stalled()).toBe(false);
    });

    it('reset cancels the timer and clears the flag', () => {
        tracker.track('loading');
        jest.advanceTimersByTime(30_000);
        expect(tracker.stalled()).toBe(true);

        tracker.reset();
        expect(tracker.stalled()).toBe(false);

        jest.advanceTimersByTime(60_000);
        expect(tracker.stalled()).toBe(false);
    });

    it('cancel alone leaves an existing stalled flag untouched', () => {
        tracker.track('loading');
        jest.advanceTimersByTime(30_000);
        tracker.cancel();
        expect(tracker.stalled()).toBe(true);
    });
});
