import type Hls from 'hls.js';
import type { PlayerTrack } from '../player-controls/player-controls.model';
import type { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';
import { WebVideoHlsControls } from './web-video-hls-controls';
import { WebVideoNativeTextTracks } from './web-video-native-text-tracks';

export type WebVideoControlsSource =
    | { kind: 'native' }
    | { kind: 'mpegts' }
    | { kind: 'hls'; hls: Hls };

export interface WebVideoSourceControlsBridgeConfig {
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
}

export class WebVideoSourceControlsBridge {
    private readonly config: WebVideoSourceControlsBridgeConfig;
    private readonly hlsControls: WebVideoHlsControls;
    private readonly nativeTextTracks: WebVideoNativeTextTracks;
    private source: WebVideoControlsSource | null = null;
    private attached = false;
    private destroyed = false;

    constructor(config: WebVideoSourceControlsBridgeConfig) {
        this.config = config;
        const refresh = () => this.config.adapter.refresh();
        this.hlsControls = new WebVideoHlsControls({
            showCaptions: config.showCaptions,
            refresh,
        });
        this.nativeTextTracks = new WebVideoNativeTextTracks({
            video: config.video,
            showCaptions: config.showCaptions,
            refresh,
        });
    }

    attach(): void {
        if (this.attached || this.destroyed) {
            return;
        }

        this.config.adapter.attach(this.config.video, {
            isLive: this.config.isLive,
            getDuration: () => this.readDuration(),
            getAudioTracks: () => this.getAudioTracks(),
            setAudioTrack: (id) => this.setAudioTrack(id),
            getSubtitleTracks: () => this.getSubtitleTracks(),
            setSubtitleTrack: (id) => this.setSubtitleTrack(id),
        });
        this.attached = true;
    }

    setSource(source: WebVideoControlsSource): void {
        if (this.destroyed) {
            return;
        }

        this.clearActiveSource();
        this.source = source;
        if (source.kind === 'hls') {
            this.hlsControls.bind(source.hls);
        } else {
            this.nativeTextTracks.bind();
        }
        this.config.adapter.refresh();
    }

    refreshInputs(): void {
        if (this.destroyed) {
            return;
        }

        if (this.source?.kind === 'hls') {
            this.hlsControls.refreshInputs();
        } else if (this.source) {
            this.nativeTextTracks.refreshInputs();
        }
        this.config.adapter.refresh();
    }

    clearSource(): void {
        if (this.destroyed) {
            return;
        }

        this.clearActiveSource();
        this.source = null;
        this.config.adapter.refresh();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.clearSource();
        if (this.attached) {
            this.config.adapter.detach();
            this.attached = false;
        }
        this.destroyed = true;
    }

    readDuration(): number {
        if (this.source?.kind !== 'mpegts' || this.config.isLive()) {
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
        return this.source?.kind === 'hls'
            ? this.hlsControls.getAudioTracks()
            : [];
    }

    private setAudioTrack(id: number): void {
        if (this.source?.kind === 'hls') {
            this.hlsControls.setAudioTrack(id);
        }
    }

    private getSubtitleTracks(): PlayerTrack[] {
        if (this.source?.kind === 'hls') {
            return this.hlsControls.getSubtitleTracks();
        }
        return this.source ? this.nativeTextTracks.getSubtitleTracks() : [];
    }

    private setSubtitleTrack(id: number): void {
        if (this.source?.kind === 'hls') {
            this.hlsControls.setSubtitleTrack(id);
        } else if (this.source) {
            this.nativeTextTracks.setSubtitleTrack(id);
        }
    }

    private clearActiveSource(): void {
        if (this.source?.kind === 'hls') {
            this.hlsControls.clear();
        } else if (this.source) {
            this.nativeTextTracks.clear();
        }
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
