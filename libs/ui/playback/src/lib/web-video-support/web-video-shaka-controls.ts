import type { PlayerTrack } from '../player-controls/player-controls.model';
import type {
    ShakaPlayerLike,
    ShakaTextTrackLike,
} from '../shaka-engine/shaka-module.types';
import type { ShakaVideoSession } from '../shaka-engine/shaka-video-session';

export interface WebVideoShakaControlsConfig {
    showCaptions: () => boolean;
    refresh: () => void;
}

const SUBTITLES_OFF = -1;

/**
 * Maps a {@link ShakaVideoSession} onto the shared-controls track contract,
 * mirroring {@link WebVideoHlsControls}. Track ids are indexes into the
 * player's current track arrays; `-1` means subtitles explicitly off.
 */
export class WebVideoShakaControls {
    private session: ShakaVideoSession | null = null;
    private unsubscribe: (() => void) | null = null;
    private subtitleOverride: number | null = null;

    constructor(private readonly config: WebVideoShakaControlsConfig) {}

    bind(session: ShakaVideoSession): void {
        this.clear();
        this.session = session;
        this.unsubscribe = session.subscribe(() => {
            this.applyCaptionState();
            this.config.refresh();
        });
        this.applyCaptionState();
    }

    clear(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.session = null;
        this.subtitleOverride = null;
    }

    refreshInputs(): void {
        this.applyCaptionState();
    }

    getAudioTracks(): PlayerTrack[] {
        return (this.getPlayer()?.getAudioTracks() ?? []).map(
            (track, index) => ({
                id: index,
                label:
                    track.label ||
                    track.language ||
                    `Audio ${index + 1}`,
                selected: track.active,
            })
        );
    }

    setAudioTrack(id: number): void {
        const player = this.getPlayer();
        if (!player || !Number.isInteger(id)) {
            return;
        }

        const track = player.getAudioTracks()[id];
        if (track) {
            player.selectAudioTrack(track);
        }
    }

    getSubtitleTracks(): PlayerTrack[] {
        const player = this.getPlayer();
        if (!player) {
            return [];
        }

        return player.getTextTracks().map((track, index) => ({
            id: index,
            label: formatTextTrackLabel(track, index),
            selected: track.active,
        }));
    }

    setSubtitleTrack(id: number): void {
        const player = this.getPlayer();
        if (!player || !Number.isInteger(id)) {
            return;
        }

        // Shaka 5 model: selecting a track shows it, null turns text off.
        if (id === SUBTITLES_OFF) {
            this.subtitleOverride = SUBTITLES_OFF;
            player.selectTextTrack(null);
            return;
        }

        const track = player.getTextTracks()[id];
        if (!track) {
            return;
        }

        this.subtitleOverride = id;
        player.selectTextTrack(track);
    }

    private applyCaptionState(): void {
        const player = this.getPlayer();
        if (!player) {
            return;
        }

        // Without an explicit user choice, keep manifest-auto-selected text
        // hidden while the captions preference is off (HLS parity). A user
        // selection (subtitleOverride) always wins.
        if (
            this.subtitleOverride === null &&
            !this.config.showCaptions() &&
            player.getTextTracks().some((track) => track.active)
        ) {
            player.selectTextTrack(null);
        }
    }

    private getPlayer(): ShakaPlayerLike | null {
        return this.session?.getPlayer() ?? null;
    }
}

function formatTextTrackLabel(
    track: ShakaTextTrackLike,
    index: number
): string {
    return track.label || track.language || `Subtitle ${index + 1}`;
}
