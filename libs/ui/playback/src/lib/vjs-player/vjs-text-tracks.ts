import type { PlayerTrack } from '../player-controls/player-controls.model';
import type {
    VideoJsPlayer,
    VideoJsTextTrack,
    VideoJsTextTrackList,
} from './vjs-player.types';

const TEXT_TRACK_EVENTS = [
    'addtrack',
    'removetrack',
    'change',
    'labelchange',
] as const;

interface VjsSubtitleTrack {
    id: number;
    track: VideoJsTextTrack;
}

export interface VjsTextTracksConfig {
    player: Pick<VideoJsPlayer, 'textTracks'>;
    showCaptions: () => boolean;
    refresh: () => void;
}

export class VjsTextTracks {
    private trackList: VideoJsTextTrackList | null = null;
    private refreshListener: EventListener | null = null;
    private trackIds = new WeakMap<VideoJsTextTrack, number>();
    private nextTrackId = 0;
    private subtitleOverride: number | null = null;
    private suppressedTrack: VideoJsTextTrack | null = null;

    constructor(private readonly config: VjsTextTracksConfig) {}

    bind(): void {
        const trackList = this.readTrackList();
        if (trackList === this.trackList) {
            this.applyCaptionState();
            return;
        }

        this.detachTrackList();
        this.resetSourceState();
        this.trackList = trackList;
        if (trackList && typeof trackList.addEventListener === 'function') {
            const refresh: EventListener = () => {
                this.applyCaptionState();
                this.config.refresh();
            };
            this.refreshListener = refresh;
            for (const event of TEXT_TRACK_EVENTS) {
                trackList.addEventListener(event, refresh);
            }
        }
        this.applyCaptionState();
    }

    clear(): void {
        this.detachTrackList();
        this.resetSourceState();
    }

    resetSource(): void {
        this.resetSourceState();
        this.applyCaptionState();
    }

    refreshInputs(): void {
        this.applyCaptionState();
    }

    getSubtitleTracks(): PlayerTrack[] {
        return this.readSubtitleTracks().map(({ id, track }) => ({
            id,
            label: track.label || track.language || `Subtitle ${id + 1}`,
            selected: track.mode === 'showing',
        }));
    }

    setSubtitleTrack(id: number): void {
        if (!Number.isInteger(id)) {
            return;
        }

        const tracks = this.readSubtitleTracks();
        if (id === -1) {
            this.subtitleOverride = -1;
            this.suppressedTrack = null;
            this.applyOverride(tracks);
            return;
        }
        if (id < 0 || !tracks.some((entry) => entry.id === id)) {
            return;
        }

        this.subtitleOverride = id;
        this.suppressedTrack = null;
        this.applyOverride(tracks);
    }

    private readTrackList(): VideoJsTextTrackList | null {
        try {
            return this.config.player.textTracks();
        } catch {
            return null;
        }
    }

    private detachTrackList(): void {
        const trackList = this.trackList;
        const refresh = this.refreshListener;
        if (
            trackList &&
            refresh &&
            typeof trackList.removeEventListener === 'function'
        ) {
            for (const event of TEXT_TRACK_EVENTS) {
                trackList.removeEventListener(event, refresh);
            }
        }
        this.trackList = null;
        this.refreshListener = null;
    }

    private resetSourceState(): void {
        this.trackIds = new WeakMap<VideoJsTextTrack, number>();
        this.nextTrackId = 0;
        this.subtitleOverride = null;
        this.suppressedTrack = null;
    }

    private readSubtitleTracks(): VjsSubtitleTrack[] {
        const tracks = this.trackList;
        if (!tracks) {
            return [];
        }

        const result: VjsSubtitleTrack[] = [];
        try {
            for (let index = 0; index < tracks.length; index += 1) {
                const track = tracks[index];
                if (
                    !track ||
                    (track.kind !== 'captions' && track.kind !== 'subtitles')
                ) {
                    continue;
                }

                let id = this.trackIds.get(track);
                if (id === undefined) {
                    id = this.nextTrackId;
                    this.nextTrackId += 1;
                    this.trackIds.set(track, id);
                }
                result.push({ id, track });
            }
        } catch {
            return [];
        }
        return result;
    }

    private applyCaptionState(): void {
        const tracks = this.readSubtitleTracks();
        if (this.subtitleOverride !== null) {
            this.applyOverride(tracks);
            return;
        }

        if (!this.config.showCaptions()) {
            const selectedTrack = tracks.find(
                ({ track }) => track.mode === 'showing'
            )?.track;
            if (selectedTrack) {
                this.suppressedTrack = selectedTrack;
            } else if (
                this.suppressedTrack &&
                !tracks.some(({ track }) => track === this.suppressedTrack)
            ) {
                this.suppressedTrack = null;
            }
            this.disableAll(tracks);
            return;
        }

        const suppressedTrack = this.suppressedTrack;
        this.suppressedTrack = null;
        const selectedTrack =
            suppressedTrack &&
            tracks.some(({ track }) => track === suppressedTrack)
                ? suppressedTrack
                : (tracks.find(({ track }) => track.mode === 'showing')
                      ?.track ?? null);
        this.applySelectedTrack(tracks, selectedTrack);
    }

    private applyOverride(tracks: VjsSubtitleTrack[]): void {
        const selectedId =
            this.subtitleOverride === -1 ? null : this.subtitleOverride;
        for (const { id, track } of tracks) {
            this.setMode(
                track,
                selectedId !== null && id === selectedId
                    ? 'showing'
                    : 'disabled'
            );
        }
    }

    private applySelectedTrack(
        tracks: VjsSubtitleTrack[],
        selectedTrack: VideoJsTextTrack | null
    ): void {
        for (const { track } of tracks) {
            this.setMode(
                track,
                track === selectedTrack ? 'showing' : 'disabled'
            );
        }
    }

    private disableAll(tracks: VjsSubtitleTrack[]): void {
        for (const { track } of tracks) {
            this.setMode(track, 'disabled');
        }
    }

    private setMode(track: VideoJsTextTrack, mode: TextTrackMode): void {
        if (track.mode !== mode) {
            track.mode = mode;
        }
    }
}
