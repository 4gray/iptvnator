import { createDevLogger } from '@iptvnator/shared/interfaces';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    classifyNativePlaybackIssue,
    createPlaybackSourceMetadata,
} from '@iptvnator/playback/util';

const debugHtmlPlayer = createDevLogger('HtmlVideoPlayer');

export interface HtmlVideoElementSessionConfig {
    video: HTMLVideoElement;
    getChannelUrl: () => string | undefined;
    getStartTime: () => number;
    emitPlaybackIssue: (issue: PlaybackDiagnostic | null) => void;
    emitTimeUpdate: (value: { currentTime: number; duration: number }) => void;
    emitPlaybackEnded: () => void;
    emitPlaybackStarted?: () => void;
}

export class HtmlVideoElementSession {
    private attached = false;

    private readonly handleNativePlaybackError = (): void => {
        const video = this.config.video;
        const url = this.config.getChannelUrl() ?? video.currentSrc;
        this.config.emitPlaybackIssue(
            classifyNativePlaybackIssue(
                video.error,
                createPlaybackSourceMetadata({
                    url,
                    player: InlinePlaybackPlayer.Html5,
                })
            )
        );
    };

    private readonly handlePlaying = (): void => {
        this.clearPlaybackIssue();
        this.config.emitPlaybackStarted?.();
    };

    private readonly clearPlaybackIssue = (): void => {
        this.config.emitPlaybackIssue(null);
    };

    private readonly handleVolumeChange = (): void => {
        const currentVolume = this.config.video.volume;
        debugHtmlPlayer('Volume changed to:', currentVolume);
        localStorage.setItem('volume', currentVolume.toString());
    };

    private readonly handleLoadedMetadata = (): void => {
        const startTime = this.config.getStartTime();
        if (startTime > 0) {
            this.config.video.currentTime = startTime;
        }
    };

    private readonly handleTimeUpdate = (): void => {
        const video = this.config.video;
        this.config.emitTimeUpdate({
            currentTime: video.currentTime,
            duration: video.duration,
        });
    };

    private readonly handlePlaybackEnded = (): void => {
        this.config.emitPlaybackEnded();
    };

    private readonly listeners: ReadonlyArray<
        readonly [event: string, listener: EventListener]
    > = [
        ['volumechange', this.handleVolumeChange],
        ['loadedmetadata', this.handleLoadedMetadata],
        ['timeupdate', this.handleTimeUpdate],
        ['error', this.handleNativePlaybackError],
        ['loadeddata', this.clearPlaybackIssue],
        ['playing', this.handlePlaying],
        ['ended', this.handlePlaybackEnded],
    ];

    constructor(private readonly config: HtmlVideoElementSessionConfig) {}

    attach(): void {
        if (this.attached) {
            return;
        }
        this.attached = true;
        for (const [event, listener] of this.listeners) {
            this.config.video.addEventListener(event, listener);
        }
    }

    play(): void {
        const playPromise = this.config.video.play();
        if (playPromise === undefined) {
            return;
        }

        // Autoplay failures are surfaced by the surrounding player UI. Caption
        // state is owned by WebVideoSourceTracks, which tracks the active
        // source engine instead of guessing once when playback starts.
        void playPromise.catch(() => undefined);
    }

    destroy(): void {
        if (!this.attached) {
            return;
        }
        this.attached = false;
        for (const [event, listener] of this.listeners) {
            this.config.video.removeEventListener(event, listener);
        }
    }
}
