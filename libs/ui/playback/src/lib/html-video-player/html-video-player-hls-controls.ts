import Hls from 'hls.js';
import type { PlayerTrack } from '../player-controls/player-controls.model';

const HLS_REFRESH_EVENTS = [
    Hls.Events.AUDIO_TRACKS_UPDATED,
    Hls.Events.AUDIO_TRACK_SWITCHING,
    Hls.Events.AUDIO_TRACK_SWITCHED,
    Hls.Events.SUBTITLE_TRACKS_UPDATED,
    Hls.Events.SUBTITLE_TRACKS_CLEARED,
    Hls.Events.SUBTITLE_TRACK_SWITCH,
    Hls.Events.MANIFEST_LOADING,
] as const;

export interface HtmlVideoPlayerHlsControlsConfig {
    showCaptions: () => boolean;
    refresh: () => void;
}

export class HtmlVideoPlayerHlsControls {
    private hls: Hls | null = null;
    private refreshListener: (() => void) | null = null;
    private subtitleOverride: number | null = null;
    private suppressedSubtitleTrack: number | null = null;

    constructor(private readonly config: HtmlVideoPlayerHlsControlsConfig) {}

    bind(hls: Hls): void {
        this.clear();
        this.hls = hls;
        const refresh = () => {
            this.applyCaptionState();
            this.config.refresh();
        };
        this.refreshListener = refresh;
        for (const event of HLS_REFRESH_EVENTS) {
            hls.on(event, refresh);
        }
        this.applyCaptionState();
    }

    clear(): void {
        if (this.hls && this.refreshListener) {
            for (const event of HLS_REFRESH_EVENTS) {
                this.hls.off(event, this.refreshListener);
            }
        }
        this.hls = null;
        this.refreshListener = null;
        this.subtitleOverride = null;
        this.suppressedSubtitleTrack = null;
    }

    refreshInputs(): void {
        this.applyCaptionState();
    }

    getAudioTracks(): PlayerTrack[] {
        if (!this.hls) {
            return [];
        }

        const hls = this.hls;
        return hls.audioTracks.map((track, index) => ({
            id: index,
            label: track.name || track.lang || `Audio ${index + 1}`,
            selected: index === hls.audioTrack,
        }));
    }

    setAudioTrack(id: number): void {
        if (
            this.hls &&
            Number.isInteger(id) &&
            id >= 0 &&
            id < this.hls.audioTracks.length
        ) {
            this.hls.audioTrack = id;
        }
    }

    getSubtitleTracks(): PlayerTrack[] {
        if (!this.hls) {
            return [];
        }

        const hls = this.hls;
        return hls.subtitleTracks.map((track, index) => ({
            id: index,
            label: track.name || track.lang || `Subtitle ${index + 1}`,
            selected:
                hls.subtitleDisplay === true && index === hls.subtitleTrack,
        }));
    }

    setSubtitleTrack(id: number): void {
        if (!this.hls || !Number.isInteger(id)) {
            return;
        }

        if (id === -1) {
            this.subtitleOverride = -1;
            this.suppressedSubtitleTrack = null;
            this.setSubtitleTrackValue(-1);
            this.setSubtitleDisplay(false);
            return;
        }
        if (id < 0 || id >= this.hls.subtitleTracks.length) {
            return;
        }

        this.subtitleOverride = id;
        this.suppressedSubtitleTrack = null;
        this.setSubtitleDisplay(true);
        this.setSubtitleTrackValue(id);
    }

    private applyCaptionState(): void {
        if (!this.hls) {
            return;
        }

        if (this.subtitleOverride !== null) {
            if (this.subtitleOverride === -1) {
                this.setSubtitleTrackValue(-1);
                this.setSubtitleDisplay(false);
                return;
            }
            if (this.subtitleOverride < this.hls.subtitleTracks.length) {
                this.setSubtitleDisplay(true);
                this.setSubtitleTrackValue(this.subtitleOverride);
            } else {
                this.setSubtitleDisplay(false);
            }
            return;
        }

        if (!this.config.showCaptions()) {
            if (
                Number.isInteger(this.hls.subtitleTrack) &&
                this.hls.subtitleTrack >= 0 &&
                this.hls.subtitleTrack < this.hls.subtitleTracks.length
            ) {
                this.suppressedSubtitleTrack = this.hls.subtitleTrack;
            }
            this.setSubtitleDisplay(false);
            return;
        }

        const suppressedTrack = this.suppressedSubtitleTrack;
        if (
            suppressedTrack !== null &&
            suppressedTrack < this.hls.subtitleTracks.length
        ) {
            this.suppressedSubtitleTrack = null;
            this.setSubtitleDisplay(true);
            this.setSubtitleTrackValue(suppressedTrack);
        }
    }

    private setSubtitleTrackValue(id: number): void {
        if (this.hls && this.hls.subtitleTrack !== id) {
            this.hls.subtitleTrack = id;
        }
    }

    private setSubtitleDisplay(display: boolean): void {
        if (this.hls && this.hls.subtitleDisplay !== display) {
            this.hls.subtitleDisplay = display;
        }
    }
}
