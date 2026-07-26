import type Hls from 'hls.js';
import type { PlayerTrack } from '../player-controls/player-controls.model';
import type { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import { WebVideoHlsControls } from './web-video-hls-controls';
import { WebVideoNativeTextTracks } from './web-video-native-text-tracks';
import { WebVideoShakaControls } from './web-video-shaka-controls';

export type WebVideoControlsSource =
    | { kind: 'native' }
    | { kind: 'mpegts' }
    | { kind: 'hls'; hls: Hls }
    | { kind: 'shaka'; session: ShakaVideoSession };

export interface WebVideoSourceTracksConfig {
    video: HTMLVideoElement;
    showCaptions: () => boolean;
    /**
     * Notifies the owning controls UI that track state changed. Legacy players
     * have no shared controls to refresh and leave it unset — they use this
     * class purely to keep the caption preference authoritative.
     */
    refresh?: () => void;
}

/**
 * Owns the per-source audio/subtitle track controllers of a web video engine.
 *
 * It is deliberately free of any controls-UI dependency so both the shared
 * controls bridge and the legacy (vendor-chrome) players can enforce the
 * `showCaptions` preference through the exact same code path.
 */
export class WebVideoSourceTracks {
    private readonly hlsControls: WebVideoHlsControls;
    private readonly shakaControls: WebVideoShakaControls;
    private readonly nativeTextTracks: WebVideoNativeTextTracks;
    private source: WebVideoControlsSource | null = null;
    private destroyed = false;

    constructor(config: WebVideoSourceTracksConfig) {
        const refresh = () => config.refresh?.();
        this.hlsControls = new WebVideoHlsControls({
            showCaptions: config.showCaptions,
            refresh,
        });
        this.shakaControls = new WebVideoShakaControls({
            showCaptions: config.showCaptions,
            refresh,
        });
        this.nativeTextTracks = new WebVideoNativeTextTracks({
            video: config.video,
            showCaptions: config.showCaptions,
            refresh,
        });
    }

    get sourceKind(): WebVideoControlsSource['kind'] | null {
        return this.source?.kind ?? null;
    }

    setSource(source: WebVideoControlsSource): void {
        if (this.destroyed) {
            return;
        }

        this.clearActiveSource();
        this.source = source;
        if (source.kind === 'hls') {
            this.hlsControls.bind(source.hls);
        } else if (source.kind === 'shaka') {
            this.shakaControls.bind(source.session);
        } else {
            this.nativeTextTracks.bind();
        }
    }

    refreshInputs(): void {
        if (this.destroyed) {
            return;
        }

        if (this.source?.kind === 'hls') {
            this.hlsControls.refreshInputs();
        } else if (this.source?.kind === 'shaka') {
            this.shakaControls.refreshInputs();
        } else if (this.source) {
            this.nativeTextTracks.refreshInputs();
        }
    }

    clearSource(): void {
        if (this.destroyed) {
            return;
        }

        this.clearActiveSource();
        this.source = null;
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.clearSource();
        this.destroyed = true;
    }

    getAudioTracks(): PlayerTrack[] {
        if (this.source?.kind === 'hls') {
            return this.hlsControls.getAudioTracks();
        }
        if (this.source?.kind === 'shaka') {
            return this.shakaControls.getAudioTracks();
        }
        return [];
    }

    setAudioTrack(id: number): void {
        if (this.source?.kind === 'hls') {
            this.hlsControls.setAudioTrack(id);
        } else if (this.source?.kind === 'shaka') {
            this.shakaControls.setAudioTrack(id);
        }
    }

    getSubtitleTracks(): PlayerTrack[] {
        if (this.source?.kind === 'hls') {
            return this.hlsControls.getSubtitleTracks();
        }
        if (this.source?.kind === 'shaka') {
            return this.shakaControls.getSubtitleTracks();
        }
        return this.source ? this.nativeTextTracks.getSubtitleTracks() : [];
    }

    setSubtitleTrack(id: number): void {
        if (this.source?.kind === 'hls') {
            this.hlsControls.setSubtitleTrack(id);
        } else if (this.source?.kind === 'shaka') {
            this.shakaControls.setSubtitleTrack(id);
        } else if (this.source) {
            this.nativeTextTracks.setSubtitleTrack(id);
        }
    }

    private clearActiveSource(): void {
        if (this.source?.kind === 'hls') {
            this.hlsControls.clear();
        } else if (this.source?.kind === 'shaka') {
            this.shakaControls.clear();
        } else if (this.source) {
            this.nativeTextTracks.clear();
        }
    }
}
