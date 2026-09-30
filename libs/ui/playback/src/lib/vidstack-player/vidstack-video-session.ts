import {
    type PlaybackDiagnostic,
    classifyNativePlaybackIssue,
} from '@iptvnator/playback/util';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import { createVidstackSourceMetadata } from './vidstack-player-setup';

export interface VidstackVideoSessionConfig {
    video: HTMLVideoElement;
    sourceUrl: string;
    getDuration: () => number;
    emitPlaybackIssue: (issue: PlaybackDiagnostic | null) => void;
    emitTimeUpdate: (value: PlayerTimeUpdate) => void;
    emitPlaybackEnded: () => void;
    emitPlaybackStarted?: () => void;
}

/**
 * Owns the native media listeners on the `<video>` of one Vidstack provider.
 * Vidstack keeps no storage of its own here, so the session persists the app
 * volume in both control modes, like the HTML5 and Video.js players.
 */
export class VidstackVideoSession {
    private attached = false;

    private readonly handleNativePlaybackError = (): void => {
        const { video, sourceUrl } = this.config;
        this.config.emitPlaybackIssue(
            classifyNativePlaybackIssue(
                video.error,
                createVidstackSourceMetadata(sourceUrl || video.currentSrc)
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
        localStorage.setItem('volume', this.config.video.volume.toString());
    };

    private readonly handlePlaybackEnded = (): void => {
        this.config.emitPlaybackEnded();
    };

    private readonly handleTimeUpdate = (): void => {
        const video = this.config.video;
        this.config.emitTimeUpdate({
            currentTime: video.currentTime,
            duration: this.config.getDuration(),
            playing: !video.paused && !video.seeking,
        });
    };

    private readonly listeners: ReadonlyArray<
        readonly [event: string, listener: EventListener]
    > = [
        ['error', this.handleNativePlaybackError],
        ['loadeddata', this.clearPlaybackIssue],
        ['playing', this.handlePlaying],
        ['volumechange', this.handleVolumeChange],
        ['ended', this.handlePlaybackEnded],
        ['timeupdate', this.handleTimeUpdate],
    ];

    constructor(private readonly config: VidstackVideoSessionConfig) {}

    get video(): HTMLVideoElement {
        return this.config.video;
    }

    attach(): void {
        if (this.attached) {
            return;
        }
        this.attached = true;
        for (const [event, listener] of this.listeners) {
            this.config.video.addEventListener(event, listener);
        }
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
