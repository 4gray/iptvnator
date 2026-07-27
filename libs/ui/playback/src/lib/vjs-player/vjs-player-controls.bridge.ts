import type { WebVideoControlsOptions } from '../player-controls/web-video-controls.adapter';
import type { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { VjsAudioTracks } from './vjs-audio-tracks';
import type { VideoJsPlayer } from './vjs-player.types';
import { VjsTextTracks } from './vjs-text-tracks';

export interface VjsPlayerControlsBridgeConfig {
    player: VideoJsPlayer;
    adapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
}

export class VjsPlayerControlsBridge {
    private readonly audioTracks: VjsAudioTracks;
    private readonly textTracks: VjsTextTracks;
    private video: HTMLVideoElement | null = null;
    private sourceActive = false;
    private destroyed = false;

    private readonly adapterOptions: WebVideoControlsOptions = {
        isLive: () => this.config.isLive(),
        getDuration: () => this.readDuration(),
        getAudioTracks: () => this.audioTracks.getAudioTracks(),
        setAudioTrack: (id) => this.audioTracks.setAudioTrack(id),
        getSubtitleTracks: () => this.textTracks.getSubtitleTracks(),
        setSubtitleTrack: (id) => this.textTracks.setSubtitleTrack(id),
    };

    constructor(private readonly config: VjsPlayerControlsBridgeConfig) {
        const refresh = () => this.config.adapter.refresh();
        this.audioTracks = new VjsAudioTracks({
            player: config.player,
            refresh,
        });
        this.textTracks = new VjsTextTracks({
            player: config.player,
            showCaptions: config.showCaptions,
            refresh,
        });
    }

    attach(video: HTMLVideoElement): void {
        if (this.destroyed || this.video === video) {
            return;
        }

        this.video = video;
        this.config.adapter.attach(video, this.adapterOptions);
        if (this.sourceActive) {
            this.bindTrackLists();
        }
    }

    rebind(video: HTMLVideoElement): void {
        this.attach(video);
    }

    setSource(): void {
        if (this.destroyed) {
            return;
        }

        this.audioTracks.resetSource();
        this.textTracks.resetSource();
        this.sourceActive = true;
        this.bindTrackLists();
        this.config.adapter.refresh();
    }

    refreshInputs(): void {
        if (this.destroyed) {
            return;
        }

        if (this.sourceActive) {
            this.bindTrackLists();
            this.textTracks.refreshInputs();
        }
        this.config.adapter.refresh();
    }

    clearSource(): void {
        if (this.destroyed) {
            return;
        }

        this.audioTracks.clear();
        this.textTracks.clear();
        this.sourceActive = false;
        this.config.adapter.refresh();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.audioTracks.clear();
        this.textTracks.clear();
        if (this.video) {
            this.config.adapter.detach();
        }
        this.video = null;
        this.sourceActive = false;
        this.destroyed = true;
    }

    private bindTrackLists(): void {
        this.audioTracks.bind();
        this.textTracks.bind();
    }

    private readDuration(): number {
        try {
            const duration = this.config.player.duration();
            return typeof duration === 'number' ? duration : NaN;
        } catch {
            return NaN;
        }
    }
}
