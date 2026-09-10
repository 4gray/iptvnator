import type {
    PlayerStreamStats,
    PlayerStreamStatsSource,
} from './player-stream-stats.model';
import { positiveOrNull } from './positive-number.util';

/**
 * What an engine adds on top of what the `<video>` element already knows.
 * Every field is optional: a native `<video src>` source supplies none of it,
 * HLS and Shaka supply most, and the element still covers resolution, frame
 * rate, buffer and frame drops on its own.
 */
export interface WebVideoEngineStats {
    streamBitrateBps?: number | null;
    videoBitrateBps?: number | null;
    audioBitrateBps?: number | null;
    videoCodec?: string | null;
    audioCodec?: string | null;
    /** Channel count or layout of the active audio rendition. */
    audioChannels?: string | number | null;
    audioSampleRateHz?: number | null;
    container?: string | null;
    /**
     * Manifest-declared frame rate, displayed separately from measured FPS.
     */
    nominalFps?: number | null;
    /** Rendition size; used only before the element reports its own. */
    width?: number | null;
    height?: number | null;
}

/** Below this the frame delta is too small to divide into a stable rate. */
const MIN_FPS_SAMPLE_SECONDS = 0.25;

/** Treat a range as the current one when the playhead is within this margin. */
const BUFFER_RANGE_TOLERANCE_SECONDS = 0.25;

interface FrameSample {
    frames: number;
    timestamp: number;
}

/**
 * Reads live stream stats from a `<video>` element, plus whatever the engine
 * bound to it can add.
 *
 * Frame rate is *measured* (presented frames between two samples) rather than
 * declared, so it reflects what the machine actually renders — the number that
 * matters when playback looks choppy.
 */
export class WebVideoStreamStatsSampler implements PlayerStreamStatsSource {
    private lastFrameSample: FrameSample | null = null;

    constructor(
        private readonly getVideo: () => HTMLVideoElement | null,
        private readonly getEngineStats: () => WebVideoEngineStats | null
    ) {}

    /** Drops frame-rate history so a new source never inherits a stale delta. */
    reset(): void {
        this.lastFrameSample = null;
    }

    sample(): PlayerStreamStats | null {
        const video = this.getVideo();
        if (!video) {
            this.lastFrameSample = null;
            return null;
        }

        const engine = this.getEngineStats() ?? {};
        const quality = readPlaybackQuality(video);
        const measuredFps = this.measureFrameRate(
            video.paused ||
                video.ended ||
                !quality ||
                (video.readyState < 2 && quality.totalVideoFrames === 0)
                ? undefined
                : quality.totalVideoFrames - quality.droppedVideoFrames
        );

        return {
            width: positiveOrNull(video.videoWidth) ?? engine.width ?? null,
            height: positiveOrNull(video.videoHeight) ?? engine.height ?? null,
            fps: measuredFps,
            nominalFps: positiveOrNull(engine.nominalFps),
            streamBitrateBps: engine.streamBitrateBps ?? null,
            videoBitrateBps: engine.videoBitrateBps ?? null,
            audioBitrateBps: engine.audioBitrateBps ?? null,
            videoCodec: engine.videoCodec ?? null,
            audioCodec: engine.audioCodec ?? null,
            audioChannels: engine.audioChannels ?? null,
            audioSampleRateHz: engine.audioSampleRateHz ?? null,
            container: engine.container ?? null,
            bufferedAheadSeconds: readBufferedAhead(video),
            droppedFrames: quality?.droppedVideoFrames ?? null,
            totalFrames: quality?.totalVideoFrames ?? null,
        };
    }

    /**
     * Presented frames per wall-clock second. A stall is a measured zero;
     * paused/initial loading playback has no measurement window. A decreasing counter
     * starts a fresh baseline after a source reset.
     */
    private measureFrameRate(totalFrames: number | undefined): number | null {
        if (typeof totalFrames !== 'number' || !Number.isFinite(totalFrames)) {
            this.lastFrameSample = null;
            return null;
        }

        const timestamp = performance.now();
        const previous = this.lastFrameSample;
        this.lastFrameSample = { frames: totalFrames, timestamp };
        if (!previous) {
            return null;
        }

        const elapsedSeconds = (timestamp - previous.timestamp) / 1000;
        const frameDelta = totalFrames - previous.frames;
        if (elapsedSeconds < MIN_FPS_SAMPLE_SECONDS || frameDelta < 0) {
            return null;
        }
        return frameDelta / elapsedSeconds;
    }
}

function readPlaybackQuality(
    video: HTMLVideoElement
): VideoPlaybackQuality | null {
    try {
        return video.getVideoPlaybackQuality?.() ?? null;
    } catch {
        return null;
    }
}

/** Seconds of continuously buffered media ahead of the playhead. */
function readBufferedAhead(video: HTMLVideoElement): number | null {
    try {
        const buffered = video.buffered;
        if (!buffered || buffered.length === 0) {
            return null;
        }
        const position = video.currentTime;
        for (let index = 0; index < buffered.length; index += 1) {
            const start = buffered.start(index);
            const end = buffered.end(index);
            if (
                position >= start - BUFFER_RANGE_TOLERANCE_SECONDS &&
                position <= end
            ) {
                return Math.max(0, end - position);
            }
        }
        // Ranges exist but none holds the playhead: nothing is buffered ahead.
        return 0;
    } catch {
        return null;
    }
}
