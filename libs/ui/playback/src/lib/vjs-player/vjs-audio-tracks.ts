import { createDevLogger } from '@iptvnator/shared/interfaces';
import type { PlayerTrack } from '../player-controls';

/**
 * Standalone Video.js audio-track helpers extracted from `VjsPlayerComponent`
 * to keep the component under the file-size cap. These are pure/imperative
 * functions over a focused {@link VjsAudioTrackPlayer} slice of the Video.js
 * player API — they cover both the native VJS skin (control-bar menu) and the
 * shared-controls path (track read/select accessors the adapter consumes).
 */

export type VideoJsAudioTrack = {
    label?: string;
    language?: string;
    enabled?: boolean;
    kind?: string;
};

export type VideoJsAudioTrackList = {
    length: number;
    [index: number]: VideoJsAudioTrack;
    addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject
    ) => void;
};

export type VideoJsTech = {
    el?: () => Element | null;
    vhs?: {
        playlists?: {
            main?: { mediaGroups?: { AUDIO?: Record<string, unknown> } };
            master?: { mediaGroups?: { AUDIO?: Record<string, unknown> } };
        };
    };
};

export type VideoJsControlChild = {
    getChild?: (name: string) => VideoJsControlChild | null;
    addChild?: (
        name: string,
        options?: Record<string, unknown>
    ) => VideoJsControlChild | null;
    show?: () => void;
    update?: () => void;
};

/** The slice of the Video.js player API the audio-track helpers depend on. */
export interface VjsAudioTrackPlayer {
    audioTracks: () => VideoJsAudioTrackList | null;
    tech: (options?: unknown) => VideoJsTech | null;
    getChild: (name: string) => VideoJsControlChild | null;
}

const debugVjsAudio = createDevLogger('VjsPlayer');

/** Projects the Video.js audio-track list onto the generic {@link PlayerTrack}. */
export function readVjsAudioTracks(player: VjsAudioTrackPlayer): PlayerTrack[] {
    const tracks = player.audioTracks();
    if (!tracks) {
        return [];
    }
    const result: PlayerTrack[] = [];
    for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        result.push({
            id: i,
            label: track.label || track.language || `Audio ${i + 1}`,
            selected: track.enabled === true,
        });
    }
    return result;
}

/** Enables the track at `id` and disables the rest. */
export function selectVjsAudioTrack(
    player: VjsAudioTrackPlayer,
    id: number
): void {
    const tracks = player.audioTracks();
    if (!tracks) {
        return;
    }
    for (let i = 0; i < tracks.length; i++) {
        tracks[i].enabled = i === id;
    }
}

/** Logs all available audio tracks (and HLS audio media groups) for debugging. */
export function logVjsAudioTracks(player: VjsAudioTrackPlayer): void {
    const audioTracks = player.audioTracks();
    debugVjsAudio(
        '[AudioTrack] Audio tracks count:',
        audioTracks?.length ?? 0
    );
    if (!audioTracks) {
        return;
    }

    for (let i = 0; i < audioTracks.length; i++) {
        const t = audioTracks[i];
        debugVjsAudio(
            `[AudioTrack] Track ${i}: label="${t.label}", language="${t.language}", enabled=${t.enabled}, kind="${t.kind}"`
        );
    }

    // Also check the underlying tech for HLS audio tracks
    const tech =
        typeof player.tech === 'function'
            ? player.tech({ IWillNotUseThisInPlugins: true })
            : null;
    const audioMediaGroups =
        tech?.vhs?.playlists?.main?.mediaGroups?.AUDIO ??
        tech?.vhs?.playlists?.master?.mediaGroups?.AUDIO;

    if (audioMediaGroups) {
        debugVjsAudio(
            '[AudioTrack] HLS AUDIO media groups:',
            JSON.stringify(Object.keys(audioMediaGroups))
        );
    } else {
        debugVjsAudio(
            '[AudioTrack] HLS AUDIO media groups: none found in playlist metadata'
        );
    }
}

/**
 * Sets up the audio track selection menu in the control bar. Uses the Video.js
 * audioTracks() API which works with both native multi-audio streams and
 * HLS.js alternate audio tracks. Used by the native (flag-OFF) VJS skin.
 */
export function setupVjsAudioTrackMenu(player: VjsAudioTrackPlayer): void {
    const audioTracks = player.audioTracks();
    debugVjsAudio(
        '[AudioTrack] setupAudioTrackMenu called, tracks:',
        audioTracks?.length ?? 0
    );
    if (!audioTracks || audioTracks.length <= 1) {
        debugVjsAudio(
            '[AudioTrack] Skipping menu: need >1 tracks, have',
            audioTracks?.length ?? 0
        );
        debugVjsAudio(
            '[AudioTrack] If VLC/MPV show more tracks, the HLS manifest likely does not expose alternate audio via EXT-X-MEDIA'
        );
        return;
    }

    const controlBar = player.getChild('controlBar');
    if (!controlBar) {
        return;
    }

    let audioButton =
        controlBar.getChild?.('audioTrackButton') ??
        controlBar.getChild?.('AudioTrackButton');
    if (!audioButton && controlBar.addChild) {
        audioButton = controlBar.addChild('audioTrackButton', {});
    }

    if (audioButton) {
        audioButton.show?.();
        audioButton.update?.();
    }
}
