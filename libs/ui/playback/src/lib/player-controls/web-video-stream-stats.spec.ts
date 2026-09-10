import {
    type WebVideoEngineStats,
    WebVideoStreamStatsSampler,
} from './web-video-stream-stats';

interface FakeVideoOptions {
    videoWidth?: number;
    videoHeight?: number;
    currentTime?: number;
    paused?: boolean;
    readyState?: number;
    buffered?: Array<[number, number]>;
    quality?: { totalVideoFrames: number; droppedVideoFrames: number } | null;
}

function createVideo(options: FakeVideoOptions = {}): HTMLVideoElement {
    const ranges = options.buffered ?? [];
    return {
        videoWidth: options.videoWidth ?? 0,
        videoHeight: options.videoHeight ?? 0,
        currentTime: options.currentTime ?? 0,
        paused: options.paused ?? false,
        readyState: options.readyState ?? 4,
        buffered: {
            length: ranges.length,
            start: (index: number) => ranges[index][0],
            end: (index: number) => ranges[index][1],
        },
        getVideoPlaybackQuality:
            options.quality === null
                ? undefined
                : () =>
                      options.quality ?? {
                          totalVideoFrames: 0,
                          droppedVideoFrames: 0,
                      },
    } as unknown as HTMLVideoElement;
}

describe('WebVideoStreamStatsSampler', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('reads size, buffer and frame counters off the element', () => {
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({
                    videoWidth: 1280,
                    videoHeight: 720,
                    currentTime: 30,
                    buffered: [[0, 42.5]],
                    quality: {
                        totalVideoFrames: 900,
                        droppedVideoFrames: 4,
                    },
                }),
            () => null
        );

        expect(sampler.sample()).toEqual(
            expect.objectContaining({
                width: 1280,
                height: 720,
                bufferedAheadSeconds: 12.5,
                droppedFrames: 4,
                totalFrames: 900,
            })
        );
    });

    it('measures the frame rate from the delta between two samples', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        let totalVideoFrames = 1000;
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({
                    quality: { totalVideoFrames, droppedVideoFrames: 0 },
                }),
            () => null
        );

        // Nothing to compare the first sample against.
        expect(sampler.sample()?.fps).toBeNull();

        jest.advanceTimersByTime(1000);
        totalVideoFrames = 1050;
        expect(sampler.sample()?.fps).toBeCloseTo(50, 5);
    });

    it('keeps the declared rate separate from measured playback', () => {
        const engine: WebVideoEngineStats = { nominalFps: 25 };
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({
                    quality: { totalVideoFrames: 10, droppedVideoFrames: 0 },
                }),
            () => engine
        );

        expect(sampler.sample()).toMatchObject({ fps: null, nominalFps: 25 });
    });

    it('reports no rate rather than zero while playback is paused', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({
                    quality: { totalVideoFrames: 500, droppedVideoFrames: 0 },
                    paused: true,
                }),
            () => null
        );

        sampler.sample();
        jest.advanceTimersByTime(1000);
        expect(sampler.sample()?.fps).toBeNull();
    });

    it('subtracts dropped frames from measured FPS but preserves total for drop percentage', () => {
        jest.useFakeTimers();
        const quality = { totalVideoFrames: 1000, droppedVideoFrames: 10 };
        const sampler = new WebVideoStreamStatsSampler(
            () => createVideo({ quality }),
            () => ({ nominalFps: 30 })
        );
        sampler.sample();
        jest.advanceTimersByTime(1000);
        quality.totalVideoFrames += 30;
        quality.droppedVideoFrames += 15;
        expect(sampler.sample()).toMatchObject({
            fps: 15,
            nominalFps: 30,
            totalFrames: 1030,
            droppedFrames: 25,
        });
    });

    it('reports zero measured FPS during a stall instead of substituting the nominal rate', () => {
        jest.useFakeTimers();
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({
                    quality: { totalVideoFrames: 100, droppedVideoFrames: 0 },
                }),
            () => ({ nominalFps: 30 })
        );
        sampler.sample();
        jest.advanceTimersByTime(1000);
        expect(sampler.sample()).toMatchObject({ fps: 0, nominalFps: 30 });
    });

    it('does not measure before media data arrives or across paused samples', () => {
        jest.useFakeTimers();
        let options: FakeVideoOptions = { readyState: 0 };
        const sampler = new WebVideoStreamStatsSampler(
            () => createVideo(options),
            () => null
        );
        sampler.sample();
        jest.advanceTimersByTime(1000);
        expect(sampler.sample()?.fps).toBeNull();
        options = { quality: { totalVideoFrames: 100, droppedVideoFrames: 0 } };
        expect(sampler.sample()?.fps).toBeNull();
        options.paused = true;
        jest.advanceTimersByTime(1000);
        expect(sampler.sample()?.fps).toBeNull();
        options.paused = false;
        jest.advanceTimersByTime(1000);
        options.quality!.totalVideoFrames += 30;
        expect(sampler.sample()?.fps).toBeNull();
    });

    it('merges engine-supplied codec, bitrate and container fields', () => {
        const sampler = new WebVideoStreamStatsSampler(
            () => createVideo({ videoWidth: 1920, videoHeight: 1080 }),
            () => ({
                videoBitrateBps: 5_000_000,
                audioBitrateBps: 192_000,
                videoCodec: 'avc1.640028',
                audioCodec: 'mp4a.40.2',
                container: 'HLS',
            })
        );

        expect(sampler.sample()).toEqual(
            expect.objectContaining({
                videoBitrateBps: 5_000_000,
                audioBitrateBps: 192_000,
                videoCodec: 'avc1.640028',
                audioCodec: 'mp4a.40.2',
                container: 'HLS',
            })
        );
    });

    it('uses the engine rendition size only until the element reports one', () => {
        let width = 0;
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({ videoWidth: width, videoHeight: width * 0.5625 }),
            () => ({ width: 1920, height: 1080 })
        );

        expect(sampler.sample()?.width).toBe(1920);

        width = 1280;
        expect(sampler.sample()?.width).toBe(1280);
    });

    it('reports an unbuffered element as unknown, not as zero seconds', () => {
        const sampler = new WebVideoStreamStatsSampler(
            () => createVideo({ buffered: [] }),
            () => null
        );

        expect(sampler.sample()?.bufferedAheadSeconds).toBeNull();
    });

    it('returns zero when ranges exist but none holds the playhead', () => {
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({
                    currentTime: 100,
                    buffered: [[0, 42]],
                }),
            () => null
        );

        expect(sampler.sample()?.bufferedAheadSeconds).toBe(0);
    });

    it('yields nothing without a bound element', () => {
        const sampler = new WebVideoStreamStatsSampler(
            () => null,
            () => null
        );

        expect(sampler.sample()).toBeNull();
    });

    it('drops frame history on reset so a new source starts measuring fresh', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        let totalVideoFrames = 1000;
        const sampler = new WebVideoStreamStatsSampler(
            () =>
                createVideo({
                    quality: { totalVideoFrames, droppedVideoFrames: 0 },
                }),
            () => null
        );

        sampler.sample();
        sampler.reset();

        jest.advanceTimersByTime(1000);
        totalVideoFrames = 1050;
        // Without the reset this would have reported 50 fps across the seam.
        expect(sampler.sample()?.fps).toBeNull();
    });
});
