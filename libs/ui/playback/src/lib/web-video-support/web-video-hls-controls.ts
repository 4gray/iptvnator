import Hls from 'hls.js';
import {
    AUTO_QUALITY_LEVEL_ID,
    type PlayerTrack,
} from '../player-controls/player-controls.model';
import { buildQualityLevelLabels } from './quality-level-labels';

export interface WebVideoHlsControlsConfig {
    showCaptions: () => boolean;
    refresh: () => void;
    /**
     * Vendor-chrome hosts pass a "playback started" probe. Its presence
     * switches the caption preference from authoritative (shared controls, the
     * default) to source-default: the preference seeds each new source and
     * stops being enforced once the probe returns true, so the engine's own
     * caption menu keeps working. Shared controls omit it — they own the
     * caption UI themselves and route user intent through `setSubtitleTrack`.
     */
    playbackStarted?: () => boolean;
}

export class WebVideoHlsControls {
    private hls: Hls | null = null;
    private refreshListener: (() => void) | null = null;
    private subtitleOverride: number | null = null;
    private suppressedSubtitleTrack: number | null = null;

    constructor(private readonly config: WebVideoHlsControlsConfig) {}

    bind(hls: Hls): void {
        this.clear();
        this.hls = hls;
        const refresh = () => {
            this.applyCaptionState();
            this.config.refresh();
        };
        this.refreshListener = refresh;
        for (const event of getHlsRefreshEvents()) {
            hls.on(event, refresh);
        }
        this.applyCaptionState();
    }

    clear(): void {
        if (this.hls && this.refreshListener) {
            for (const event of getHlsRefreshEvents()) {
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

    getQualityLevels(): PlayerTrack[] {
        const hls = this.hls;
        if (!hls) {
            return [];
        }

        const levels = hls.levels ?? [];
        const labels = buildQualityLevelLabels(levels);
        // `manualLevel` is -1 in auto mode, so no level reports selected then.
        const manualLevel =
            typeof hls.manualLevel === 'number' ? hls.manualLevel : -1;
        return levels.map((_level, index) => ({
            id: index,
            label: labels[index],
            selected: index === manualLevel,
        }));
    }

    setQualityLevel(id: number): void {
        const hls = this.hls;
        if (!hls || !Number.isInteger(id)) {
            return;
        }

        // `nextLevel` switches at the next fragment instead of flushing the
        // buffer (`currentLevel` would), so the picture never stalls.
        if (id === AUTO_QUALITY_LEVEL_ID) {
            hls.nextLevel = -1;
            return;
        }
        if (id >= 0 && id < (hls.levels?.length ?? 0)) {
            hls.nextLevel = id;
        }
    }

    isAutoQualityEnabled(): boolean {
        // A fake or torn-down instance without the flag counts as auto.
        return this.hls ? this.hls.autoLevelEnabled !== false : true;
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
            const selectedTrack = this.readSelectedSubtitleTrack();
            if (this.config.playbackStarted) {
                if (this.config.playbackStarted() || selectedTrack === null) {
                    return;
                }
                // Deselect instead of hiding: hls.js keeps `subtitleDisplay`
                // authoritative over the track the vendor caption menu picks,
                // so suppressing display would make that menu inert. A `-1`
                // assignment also clears hls.js' own default-track selection,
                // so it will not reselect one behind the user's back.
                this.suppressedSubtitleTrack = selectedTrack;
                this.setSubtitleTrackValue(-1);
                return;
            }

            // HLS may choose its default track while display is suppressed.
            // Explicit user-off remains owned by subtitleOverride === -1 above.
            if (selectedTrack !== null) {
                this.suppressedSubtitleTrack = selectedTrack;
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

    /** Current subtitle index, or null when nothing valid is selected. */
    private readSelectedSubtitleTrack(): number | null {
        const hls = this.hls;
        if (!hls) {
            return null;
        }
        return Number.isInteger(hls.subtitleTrack) &&
            hls.subtitleTrack >= 0 &&
            hls.subtitleTrack < hls.subtitleTracks.length
            ? hls.subtitleTrack
            : null;
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

function getHlsRefreshEvents() {
    return [
        Hls.Events.AUDIO_TRACKS_UPDATED,
        Hls.Events.AUDIO_TRACK_SWITCHING,
        Hls.Events.AUDIO_TRACK_SWITCHED,
        Hls.Events.SUBTITLE_TRACKS_UPDATED,
        Hls.Events.SUBTITLE_TRACKS_CLEARED,
        Hls.Events.SUBTITLE_TRACK_SWITCH,
        Hls.Events.MANIFEST_LOADING,
        Hls.Events.MANIFEST_PARSED,
        Hls.Events.LEVELS_UPDATED,
        Hls.Events.LEVEL_SWITCHED,
    ] as const;
}
