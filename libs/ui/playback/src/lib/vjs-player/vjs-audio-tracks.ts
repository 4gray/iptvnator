import { createDevLogger } from '@iptvnator/shared/interfaces';
import type { PlayerTrack } from '../player-controls/player-controls.model';
import type {
    VideoJsAudioTrack,
    VideoJsAudioTrackList,
    VideoJsPlayer,
} from './vjs-player.types';

const AUDIO_TRACK_LISTENERS = {
    addtrack: 'addtrack',
    removetrack: 'removetrack',
    change: 'change',
    labelchange: 'labelchange',
} as const;

const debugVjsAudio = createDevLogger('VjsPlayer');

export type VjsAudioTrackPlayer = Pick<
    VideoJsPlayer,
    'audioTracks' | 'getChild' | 'tech'
>;

export interface VjsAudioTracksConfig {
    player: VjsAudioTrackPlayer;
    refresh: () => void;
}

export function logVjsAudioTracks(player: VjsAudioTrackPlayer): void {
    const audioTracks = player.audioTracks();
    debugVjsAudio('[AudioTrack] Audio tracks count:', audioTracks?.length ?? 0);
    if (!audioTracks) {
        return;
    }

    for (let index = 0; index < audioTracks.length; index += 1) {
        const track = audioTracks[index];
        debugVjsAudio(
            `[AudioTrack] Track ${index}: label="${track.label}", language="${track.language}", enabled=${track.enabled}, kind="${track.kind}"`
        );
    }

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

export class VjsAudioTracks {
    private trackList: VideoJsAudioTrackList | null = null;
    private trackIds = new WeakMap<VideoJsAudioTrack, number>();
    private nextTrackId = 0;
    private readonly handleAddTrack: EventListener = () => {
        debugVjsAudio(
            '[AudioTrack] addtrack event fired, total tracks:',
            this.trackList?.length ?? 0
        );
        logVjsAudioTracks(this.config.player);
        setupVjsAudioTrackMenu(this.config.player);
        this.config.refresh();
    };
    private readonly handleRemoveTrack: EventListener = () => {
        debugVjsAudio(
            '[AudioTrack] removetrack event fired, total tracks:',
            this.trackList?.length ?? 0
        );
        logVjsAudioTracks(this.config.player);
        setupVjsAudioTrackMenu(this.config.player);
        this.config.refresh();
    };
    private readonly handleChange: EventListener = () => {
        logVjsAudioTracks(this.config.player);
        this.config.refresh();
    };
    private readonly handleLabelChange: EventListener = () => {
        logVjsAudioTracks(this.config.player);
        this.config.refresh();
    };

    constructor(private readonly config: VjsAudioTracksConfig) {}

    bind(): void {
        const trackList = this.config.player.audioTracks();
        if (trackList === this.trackList) {
            return;
        }

        this.detachTrackList();
        this.trackList = trackList;
        if (typeof trackList?.addEventListener !== 'function') {
            return;
        }

        trackList.addEventListener(
            AUDIO_TRACK_LISTENERS.addtrack,
            this.handleAddTrack
        );
        trackList.addEventListener(
            AUDIO_TRACK_LISTENERS.removetrack,
            this.handleRemoveTrack
        );
        trackList.addEventListener(
            AUDIO_TRACK_LISTENERS.change,
            this.handleChange
        );
        trackList.addEventListener(
            AUDIO_TRACK_LISTENERS.labelchange,
            this.handleLabelChange
        );
    }

    clear(): void {
        this.detachTrackList();
        this.trackList = null;
        this.resetSource();
    }

    resetSource(): void {
        this.trackIds = new WeakMap<VideoJsAudioTrack, number>();
        this.nextTrackId = 0;
    }

    getAudioTracks(): PlayerTrack[] {
        const tracks = this.trackList;
        if (!tracks) {
            return [];
        }

        const result: PlayerTrack[] = [];
        for (let index = 0; index < tracks.length; index += 1) {
            const track = tracks[index];
            if (!track) {
                continue;
            }
            let id = this.trackIds.get(track);
            if (id === undefined) {
                id = this.nextTrackId;
                this.nextTrackId += 1;
                this.trackIds.set(track, id);
            }
            result.push({
                id,
                label: track.label || track.language || `Audio ${id + 1}`,
                selected: track.enabled === true,
            });
        }
        return result;
    }

    setAudioTrack(id: number): void {
        if (!Number.isInteger(id) || !this.trackList) {
            return;
        }

        const tracks = this.trackList;
        let selectedTrack: VideoJsAudioTrack | null = null;
        for (let index = 0; index < tracks.length; index += 1) {
            const track = tracks[index];
            if (track && this.trackIds.get(track) === id) {
                selectedTrack = track;
                break;
            }
        }
        if (!selectedTrack) {
            return;
        }

        for (let index = 0; index < tracks.length; index += 1) {
            const track = tracks[index];
            if (track) {
                track.enabled = track === selectedTrack;
            }
        }
    }

    private detachTrackList(): void {
        const trackList = this.trackList;
        if (typeof trackList?.removeEventListener !== 'function') {
            return;
        }

        trackList.removeEventListener(
            AUDIO_TRACK_LISTENERS.addtrack,
            this.handleAddTrack
        );
        trackList.removeEventListener(
            AUDIO_TRACK_LISTENERS.removetrack,
            this.handleRemoveTrack
        );
        trackList.removeEventListener(
            AUDIO_TRACK_LISTENERS.change,
            this.handleChange
        );
        trackList.removeEventListener(
            AUDIO_TRACK_LISTENERS.labelchange,
            this.handleLabelChange
        );
    }
}
