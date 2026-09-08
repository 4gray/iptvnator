import {
    ControlsStreamStats,
    STREAM_STATS_SAMPLE_INTERVAL_MS,
} from './controls-stream-stats';
import { type PlayerStreamStatsSource } from './player-stream-stats.model';
import { emptyStreamStats } from './stream-stats.spec-helpers';

describe('ControlsStreamStats', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const createSource = (
        sample: jest.Mock = jest.fn(() => emptyStreamStats({ fps: 25 }))
    ): { source: PlayerStreamStatsSource; sample: jest.Mock } => ({
        source: { sample: sample as PlayerStreamStatsSource['sample'] },
        sample,
    });

    it('samples nothing until it is started', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        jest.advanceTimersByTime(5 * STREAM_STATS_SAMPLE_INTERVAL_MS);

        expect(sample).not.toHaveBeenCalled();
        expect(stats.rows()).toEqual([]);
    });

    it('samples immediately on start, then on the interval', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        expect(sample).toHaveBeenCalledTimes(1);
        expect(stats.hasRows()).toBe(true);

        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 3);
        expect(sample).toHaveBeenCalledTimes(4);
    });

    it('stops sampling and forgets the snapshot when closed', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        stats.stop();
        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 3);

        expect(sample).toHaveBeenCalledTimes(1);
        // A reopen must show fresh numbers, never the previous stream's.
        expect(stats.rows()).toEqual([]);
    });

    it('restarting does not leave a second interval running', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        stats.start();
        sample.mockClear();

        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS);
        expect(sample).toHaveBeenCalledTimes(1);
    });

    it('renders rows from the sampled snapshot', () => {
        const { source } = createSource(
            jest.fn(() => emptyStreamStats({ width: 1920, height: 1080 }))
        );
        const stats = new ControlsStreamStats(() => source);

        stats.start();

        expect(stats.rows()).toEqual([
            {
                labelKey: 'EMBEDDED_MPV.PLAYER.STATS_RESOLUTION',
                value: '1920 × 1080 · 16:9',
            },
        ]);
    });

    it('survives an engine that throws while tearing down', () => {
        const { source } = createSource(
            jest.fn(() => {
                throw new Error('engine gone');
            })
        );
        const stats = new ControlsStreamStats(() => source);

        expect(() => stats.start()).not.toThrow();
        expect(stats.hasRows()).toBe(false);
    });

    it('treats a controller without a stats source as empty', () => {
        const stats = new ControlsStreamStats(() => undefined);

        stats.start();

        expect(stats.hasRows()).toBe(false);
    });

    it('clears its interval on dispose', () => {
        const { source, sample } = createSource();
        const stats = new ControlsStreamStats(() => source);

        stats.start();
        stats.dispose();
        jest.advanceTimersByTime(STREAM_STATS_SAMPLE_INTERVAL_MS * 2);

        expect(sample).toHaveBeenCalledTimes(1);
    });
});
