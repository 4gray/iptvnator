import type Hls from 'hls.js';
import type { PlayerTrack } from '../player-controls/player-controls.model';
import type { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import type { ExternalSubtitleFile } from './external-subtitle-cues.util';
import { WebVideoExternalSubtitles } from './web-video-external-subtitles';
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
     * class purely to apply the caption preference.
     */
    refresh?: () => void;
    /**
     * Set by hosts that keep the engine's own caption UI (the preference-off
     * players). The caption preference then seeds each new source instead of
     * staying authoritative, so the vendor caption menu keeps working once
     * playback is running. Shared controls own the caption UI and omit it.
     */
    vendorCaptionControls?: boolean;
}

/**
 * Owns the per-source audio/subtitle track controllers of a web video engine.
 *
 * It is deliberately free of any controls-UI dependency so both the shared
 * controls bridge and the legacy (vendor-chrome) players apply the
 * `showCaptions` preference through the exact same code path.
 */
export class WebVideoSourceTracks {
    private readonly config: WebVideoSourceTracksConfig;
    private readonly hlsControls: WebVideoHlsControls;
    private readonly shakaControls: WebVideoShakaControls;
    private readonly nativeTextTracks: WebVideoNativeTextTracks;
    private readonly externalSubtitles: WebVideoExternalSubtitles;
    private source: WebVideoControlsSource | null = null;
    private playbackStarted = false;
    private playingListener: (() => void) | null = null;
    private destroyed = false;

    constructor(config: WebVideoSourceTracksConfig) {
        this.config = config;
        const refresh = () => config.refresh?.();
        const playbackStarted = config.vendorCaptionControls
            ? () => this.playbackStarted
            : undefined;
        this.hlsControls = new WebVideoHlsControls({
            showCaptions: config.showCaptions,
            refresh,
            playbackStarted,
        });
        this.shakaControls = new WebVideoShakaControls({
            showCaptions: config.showCaptions,
            refresh,
            playbackStarted,
        });
        this.externalSubtitles = new WebVideoExternalSubtitles({
            getVideo: () => this.config.video,
            deselectEngineSubtitles: () => this.applyEngineSubtitleTrack(-1),
            refresh,
        });
        this.nativeTextTracks = new WebVideoNativeTextTracks({
            video: config.video,
            showCaptions: config.showCaptions,
            refresh,
            playbackStarted,
            excludeTrack: (track) => this.externalSubtitles.ownsTrack(track),
        });
        if (config.vendorCaptionControls) {
            const listener = () => {
                this.playbackStarted = true;
            };
            this.playingListener = listener;
            config.video.addEventListener('playing', listener);
        }
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
        // A new source starts unsettled so its own defaults are seeded again.
        this.playbackStarted = false;
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
        if (this.playingListener) {
            this.config.video.removeEventListener(
                'playing',
                this.playingListener
            );
            this.playingListener = null;
        }
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
        // The native enumeration excludes external tracks, so appending them
        // here is collision-free for every source kind.
        return [
            ...this.getEngineSubtitleTracks(),
            ...this.externalSubtitles.getTracks(),
        ];
    }

    setSubtitleTrack(id: number): void {
        if (this.externalSubtitles.ownsTrackId(id)) {
            // select() also turns the engine-owned selection off.
            this.externalSubtitles.select(id);
            return;
        }
        this.externalSubtitles.deselectAll();
        this.applyEngineSubtitleTrack(id);
    }

    /** Loads a user-picked subtitle file and selects it. */
    addExternalSubtitleFile(file: ExternalSubtitleFile): boolean {
        return this.externalSubtitles.addFromFile(file);
    }

    getExternalSubtitleDelay(): number {
        return this.externalSubtitles.getDelay();
    }

    setExternalSubtitleDelay(seconds: number): void {
        this.externalSubtitles.setDelay(seconds);
    }

    /** Delay applies to owned external cues only, so it needs a loaded file. */
    canAdjustSubtitleDelay(): boolean {
        return this.externalSubtitles.hasTracks();
    }

    private getEngineSubtitleTracks(): PlayerTrack[] {
        if (this.source?.kind === 'hls') {
            return this.hlsControls.getSubtitleTracks();
        }
        if (this.source?.kind === 'shaka') {
            return this.shakaControls.getSubtitleTracks();
        }
        return this.source ? this.nativeTextTracks.getSubtitleTracks() : [];
    }

    private applyEngineSubtitleTrack(id: number): void {
        if (this.source?.kind === 'hls') {
            this.hlsControls.setSubtitleTrack(id);
        } else if (this.source?.kind === 'shaka') {
            this.shakaControls.setSubtitleTrack(id);
        } else if (this.source) {
            this.nativeTextTracks.setSubtitleTrack(id);
        }
    }

    private clearActiveSource(): void {
        // External files correct one specific stream; drop them with it.
        this.externalSubtitles.clear();
        if (this.source?.kind === 'hls') {
            this.hlsControls.clear();
        } else if (this.source?.kind === 'shaka') {
            this.shakaControls.clear();
        } else if (this.source) {
            this.nativeTextTracks.clear();
        }
    }
}
