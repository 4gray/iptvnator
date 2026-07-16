import type Artplayer from 'artplayer';
import {
    InlinePlaybackPlayer,
    type PlaybackDiagnostic,
    classifyNativePlaybackIssue,
    createPlaybackSourceMetadata,
} from '../playback-diagnostics/playback-diagnostics.util';

export interface ArtPlayerVideoSessionConfig {
    player: Artplayer;
    sourceUrl: string;
    getStartTime: () => number;
    getDuration: () => number;
    persistSharedVolume: boolean;
    emitPlaybackIssue: (issue: PlaybackDiagnostic | null) => void;
    emitTimeUpdate: (value: { currentTime: number; duration: number }) => void;
    emitPlaybackEnded: () => void;
}

/** Owns native video and ArtPlayer event listeners for one player instance. */
export class ArtPlayerVideoSession {
    private attached = false;
    private destroyed = false;

    private readonly handleNativePlaybackError = (): void => {
        const { player, sourceUrl } = this.config;
        this.config.emitPlaybackIssue(
            classifyNativePlaybackIssue(
                player.video.error,
                createPlaybackSourceMetadata({
                    url: sourceUrl || player.video.currentSrc,
                    player: InlinePlaybackPlayer.ArtPlayer,
                })
            )
        );
    };

    private readonly clearPlaybackIssue = (): void => {
        this.config.emitPlaybackIssue(null);
    };

    private readonly handleVolumeChange = (): void => {
        if (!this.config.persistSharedVolume) {
            return;
        }
        localStorage.setItem(
            'volume',
            this.config.player.video.volume.toString()
        );
    };

    private readonly handlePlaybackEnded = (): void => {
        this.config.emitPlaybackEnded();
    };

    private readonly handleReady = (): void => {
        const startTime = this.config.getStartTime();
        if (startTime > 0) {
            this.config.player.seek = startTime;
        }
    };

    private readonly handleTimeUpdate = (): void => {
        const player = this.config.player;
        this.config.emitTimeUpdate({
            currentTime: player.currentTime,
            duration: this.config.getDuration(),
        });
    };

    private readonly nativeListeners: ReadonlyArray<
        readonly [event: string, listener: EventListener]
    > = [
        ['error', this.handleNativePlaybackError],
        ['loadeddata', this.clearPlaybackIssue],
        ['playing', this.clearPlaybackIssue],
        ['volumechange', this.handleVolumeChange],
        ['ended', this.handlePlaybackEnded],
    ];

    constructor(private readonly config: ArtPlayerVideoSessionConfig) {}

    attach(): void {
        if (this.attached || this.destroyed) {
            return;
        }

        this.attached = true;
        for (const [event, listener] of this.nativeListeners) {
            this.config.player.video.addEventListener(event, listener);
        }
        this.config.player.on('ready', this.handleReady);
        this.config.player.on('video:timeupdate', this.handleTimeUpdate);
    }

    destroy(): void {
        if (!this.attached || this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.attached = false;
        for (const [event, listener] of this.nativeListeners) {
            this.config.player.video.removeEventListener(event, listener);
        }
        this.config.player.off('ready', this.handleReady);
        this.config.player.off('video:timeupdate', this.handleTimeUpdate);
    }
}
