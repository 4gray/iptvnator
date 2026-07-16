import mpegts from 'mpegts.js';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    classifyMpegTsPlaybackIssue,
    createPlaybackSourceMetadata,
    getPlaybackMediaExtensionFromUrl,
} from '../playback-diagnostics/playback-diagnostics.util';

interface VjsDurationPlayer {
    duration(value?: number): unknown;
}

export interface VjsMpegTsSessionConfig {
    player: () => VjsDurationPlayer;
    isLive: () => boolean;
    emitPlaybackIssue: (issue: PlaybackDiagnostic) => void;
}

const VOD_DURATION_EVENTS = [
    'durationchange',
    'loadedmetadata',
    'progress',
    'timeupdate',
    'error',
] as const;

export class VjsMpegTsSession {
    private engine: mpegts.Player | null = null;
    private video: HTMLVideoElement | null = null;
    private errorListener: ((...args: unknown[]) => void) | null = null;

    constructor(private readonly config: VjsMpegTsSessionConfig) {}

    isSupportedSource(url?: string): boolean {
        if (!url) {
            return false;
        }

        const extension = getPlaybackMediaExtensionFromUrl(url);
        return (extension === 'ts' || !extension) && mpegts.isSupported();
    }

    start(url: string, video: HTMLVideoElement): void {
        this.destroy();
        const isLive = this.config.isLive();
        const engine = mpegts.createPlayer({
            type: 'mpegts',
            isLive,
            url,
        });
        this.engine = engine;
        this.video = video;
        this.errorListener = (
            type: unknown,
            details: unknown,
            info: unknown
        ) => {
            this.syncDuration();
            this.config.emitPlaybackIssue(
                classifyMpegTsPlaybackIssue(
                    {
                        type: typeof type === 'string' ? type : undefined,
                        details:
                            typeof details === 'string' ? details : undefined,
                        info,
                    },
                    createPlaybackSourceMetadata({
                        url,
                        mimeType: 'video/mp2t',
                        player: InlinePlaybackPlayer.VideoJs,
                    })
                )
            );
        };

        engine.attachMediaElement(video);
        if (!isLive) {
            this.bindDurationEvents(video);
        }
        engine.on(mpegts.Events.ERROR, this.errorListener);
        engine.load();
        void engine.play();
    }

    syncDuration(): void {
        if (this.config.isLive() || !this.video) {
            return;
        }

        const duration =
            this.readLastFinitePositiveEnd(this.video.seekable) ??
            this.readLastFinitePositiveEnd(this.video.buffered);
        if (!duration) {
            return;
        }

        const player = this.config.player();
        if (player.duration() !== duration) {
            player.duration(duration);
        }
    }

    destroy(): void {
        const video = this.video;
        if (video) {
            for (const eventName of VOD_DURATION_EVENTS) {
                video.removeEventListener(eventName, this.scheduleDurationSync);
            }
        }
        this.video = null;

        const engine = this.engine;
        if (!engine) {
            this.errorListener = null;
            return;
        }

        if (this.errorListener) {
            engine.off(mpegts.Events.ERROR, this.errorListener);
        }
        this.errorListener = null;
        engine.pause();
        engine.unload();
        engine.detachMediaElement();
        engine.destroy();
        this.engine = null;
    }

    private readonly scheduleDurationSync = () => {
        this.syncDuration();
        this.queueMicrotask(() => this.syncDuration());
    };

    private bindDurationEvents(video: HTMLVideoElement): void {
        for (const eventName of VOD_DURATION_EVENTS) {
            video.addEventListener(eventName, this.scheduleDurationSync);
        }
        this.syncDuration();
    }

    private readLastFinitePositiveEnd(ranges: TimeRanges): number | null {
        for (let index = ranges.length - 1; index >= 0; index -= 1) {
            try {
                const end = ranges.end(index);
                if (Number.isFinite(end) && end > 0) {
                    return end;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    private queueMicrotask(callback: () => void): void {
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(callback);
            return;
        }
        void Promise.resolve().then(callback);
    }
}
