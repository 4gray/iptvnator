import type { PlayerTrack } from '../player-controls/player-controls.model';
import type { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { pickExternalSubtitleFile } from './web-video-external-subtitles';
import { WebVideoSubtitleStyle } from './web-video-subtitle-style';
import {
    type WebVideoControlsSource,
    WebVideoSourceTracks,
} from './web-video-source-tracks';

export type { WebVideoControlsSource };

export interface WebVideoSourceControlsBridgeConfig {
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
}

export class WebVideoSourceControlsBridge {
    private readonly config: WebVideoSourceControlsBridgeConfig;
    private readonly tracks: WebVideoSourceTracks;
    private readonly subtitleStyle = new WebVideoSubtitleStyle();
    private attached = false;
    private destroyed = false;

    constructor(config: WebVideoSourceControlsBridgeConfig) {
        this.config = config;
        this.tracks = new WebVideoSourceTracks({
            video: config.video,
            showCaptions: config.showCaptions,
            refresh: () => this.config.adapter.refresh(),
        });
    }

    attach(): void {
        if (this.attached || this.destroyed) {
            return;
        }

        this.subtitleStyle.attach(this.config.video);
        this.config.adapter.attach(this.config.video, {
            isLive: this.config.isLive,
            getDuration: () => this.readDuration(),
            getAudioTracks: () => this.getAudioTracks(),
            setAudioTrack: (id) => this.setAudioTrack(id),
            getSubtitleTracks: () => this.getSubtitleTracks(),
            setSubtitleTrack: (id) => this.setSubtitleTrack(id),
            addExternalSubtitleFile: () => this.pickExternalSubtitle(),
            getSubtitleDelay: () => this.tracks.getExternalSubtitleDelay(),
            setSubtitleDelay: (seconds) =>
                this.tracks.setExternalSubtitleDelay(seconds),
            canAdjustSubtitleDelay: () => this.tracks.canAdjustSubtitleDelay(),
            getSubtitleStyle: () => this.subtitleStyle.current(),
            setSubtitleStyle: (style) => this.subtitleStyle.set(style),
        });
        this.attached = true;
    }

    setSource(source: WebVideoControlsSource): void {
        if (this.destroyed) {
            return;
        }

        this.tracks.setSource(source);
        this.config.adapter.refresh();
    }

    refreshInputs(): void {
        if (this.destroyed) {
            return;
        }

        this.tracks.refreshInputs();
        this.config.adapter.refresh();
    }

    clearSource(): void {
        if (this.destroyed) {
            return;
        }

        this.tracks.clearSource();
        this.config.adapter.refresh();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.clearSource();
        this.tracks.destroy();
        this.subtitleStyle.destroy();
        if (this.attached) {
            this.config.adapter.detach();
            this.attached = false;
        }
        this.destroyed = true;
    }

    private pickExternalSubtitle(): void {
        pickExternalSubtitleFile(this.config.video.ownerDocument, (file) => {
            if (this.destroyed) {
                return;
            }
            this.tracks.addExternalSubtitleFile(file);
            this.config.adapter.refresh();
        });
    }

    readDuration(): number {
        if (this.tracks.sourceKind !== 'mpegts' || this.config.isLive()) {
            return NaN;
        }

        const videoDuration = this.readFinitePositive(() => {
            return this.config.video.duration;
        });
        if (!Number.isNaN(videoDuration)) {
            return videoDuration;
        }

        const seekableEnd = this.readLastFinitePositiveEnd(() => {
            return this.config.video.seekable;
        });
        if (!Number.isNaN(seekableEnd)) {
            return seekableEnd;
        }

        return this.readLastFinitePositiveEnd(() => {
            return this.config.video.buffered;
        });
    }

    private getAudioTracks(): PlayerTrack[] {
        return this.tracks.getAudioTracks();
    }

    private setAudioTrack(id: number): void {
        this.tracks.setAudioTrack(id);
    }

    private getSubtitleTracks(): PlayerTrack[] {
        return this.tracks.getSubtitleTracks();
    }

    private setSubtitleTrack(id: number): void {
        this.tracks.setSubtitleTrack(id);
    }

    private readFinitePositive(read: () => number): number {
        try {
            const value = read();
            return Number.isFinite(value) && value > 0 ? value : NaN;
        } catch {
            return NaN;
        }
    }

    private readLastFinitePositiveEnd(read: () => TimeRanges): number {
        try {
            const ranges = read();
            for (let index = ranges.length - 1; index >= 0; index -= 1) {
                const end = ranges.end(index);
                if (Number.isFinite(end) && end > 0) {
                    return end;
                }
            }
        } catch {
            return NaN;
        }
        return NaN;
    }
}
