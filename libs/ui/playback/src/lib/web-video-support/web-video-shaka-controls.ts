import {
    AUTO_QUALITY_LEVEL_ID,
    type PlayerTrack,
} from '../player-controls/player-controls.model';
import type {
    ShakaPlayerLike,
    ShakaTextTrackLike,
    ShakaVariantTrackLike,
} from '../shaka-engine/shaka-module.types';
import type { ShakaVideoSession } from '../shaka-engine/shaka-video-session';
import { buildQualityLevelLabels } from './quality-level-labels';

export interface WebVideoShakaControlsConfig {
    showCaptions: () => boolean;
    refresh: () => void;
    /**
     * Vendor-chrome hosts pass a "playback started" probe, mirroring the HLS
     * and native helpers. `ShakaVideoSession` already seeds the preference once
     * the manifest is loaded, so re-suppressing on every later Shaka event
     * would only override selections the host cannot see. Shared controls own
     * the caption UI and omit it, staying authoritative.
     */
    playbackStarted?: () => boolean;
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
    /**
     * The exact player a manual quality selection disabled ABR on. Each
     * `ShakaVideoSession.start` creates a fresh player with ABR back on, so
     * keying manual state to the instance (not a boolean) means a session
     * restart can never render a stale manual selection.
     */
    private manualQualityPlayer: ShakaPlayerLike | null = null;

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
        this.manualQualityPlayer = null;
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

    getQualityLevels(): PlayerTrack[] {
        const player = this.getPlayer();
        if (!player) {
            return [];
        }

        const candidates = listQualityCandidates(player);
        const labels = buildQualityLevelLabels(
            candidates.map((track) => ({
                height: track.height,
                width: track.width,
                bitrate: track.bandwidth,
            }))
        );
        const manual = !this.isAutoQualityEnabled();
        return candidates.map((track, index) => ({
            id: index,
            label: labels[index],
            selected: manual && track.active,
        }));
    }

    setQualityLevel(id: number): void {
        const player = this.getPlayer();
        if (!player || !Number.isInteger(id)) {
            return;
        }

        if (id === AUTO_QUALITY_LEVEL_ID) {
            player.configure({ abr: { enabled: true } });
            this.manualQualityPlayer = null;
            return;
        }

        const track = listQualityCandidates(player)[id];
        if (!track) {
            return;
        }

        // ABR must be off first or the ABR manager overrides the selection.
        player.configure({ abr: { enabled: false } });
        player.selectVariantTrack(track, true);
        this.manualQualityPlayer = player;
    }

    isAutoQualityEnabled(): boolean {
        const player = this.getPlayer();
        return !player || this.manualQualityPlayer !== player;
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
        const session = this.session;
        if (!session || this.subtitleOverride !== null) {
            // A user selection (subtitleOverride) always wins.
            return;
        }

        // Without an explicit user choice, mirror the HLS bridge: keep
        // manifest-auto-selected text hidden while the captions preference is
        // off, and reselect the suppressed track when it turns back on.
        if (this.config.showCaptions()) {
            session.restoreSuppressedTextTrack();
            return;
        }
        if (this.config.playbackStarted?.()) {
            // Source-default mode: the session already seeded this source at
            // load time, so leave the running selection alone.
            return;
        }
        session.suppressTextTracks();
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

/**
 * Variants are audio+video combinations; picking a quality must not switch
 * the spoken language, so only variants matching the active audio language
 * are selectable. Sorting (resolution, then bandwidth, descending) keeps the
 * ids deterministic across refreshes of the same track set.
 */
function listQualityCandidates(
    player: ShakaPlayerLike
): ShakaVariantTrackLike[] {
    const variants = player.getVariantTracks();
    const activeLanguage = variants.find((track) => track.active)?.language;
    const candidates = activeLanguage
        ? variants.filter((track) => track.language === activeLanguage)
        : [...variants];
    return candidates.sort(
        (a, b) =>
            (b.height ?? 0) - (a.height ?? 0) ||
            (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
    );
}
