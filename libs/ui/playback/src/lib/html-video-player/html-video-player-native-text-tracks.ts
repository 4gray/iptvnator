import type { PlayerTrack } from '../player-controls/player-controls.model';

const NATIVE_TRACK_EVENTS = ['addtrack', 'removetrack', 'change'] as const;

interface NativeSubtitleTrack {
    id: number;
    track: TextTrack;
}

export interface HtmlVideoPlayerNativeTextTracksConfig {
    video: HTMLVideoElement;
    showCaptions: () => boolean;
    refresh: () => void;
}

export class HtmlVideoPlayerNativeTextTracks {
    private textTrackList: TextTrackList | null = null;
    private refreshListener: EventListener | null = null;
    private trackIds = new WeakMap<TextTrack, number>();
    private suppressedModes = new WeakMap<TextTrack, TextTrackMode>();
    private nextTrackId = 0;
    private subtitleOverride: number | null = null;
    private active = false;

    constructor(
        private readonly config: HtmlVideoPlayerNativeTextTracksConfig
    ) {}

    bind(): void {
        this.clear();
        this.active = true;
        const textTracks = this.config.video.textTracks;
        if (typeof textTracks.addEventListener === 'function') {
            const refresh: EventListener = () => {
                this.applyCaptionState();
                this.config.refresh();
            };
            this.textTrackList = textTracks;
            this.refreshListener = refresh;
            for (const event of NATIVE_TRACK_EVENTS) {
                textTracks.addEventListener(event, refresh);
            }
        }
        this.applyCaptionState();
    }

    clear(): void {
        if (
            this.textTrackList &&
            this.refreshListener &&
            typeof this.textTrackList.removeEventListener === 'function'
        ) {
            for (const event of NATIVE_TRACK_EVENTS) {
                this.textTrackList.removeEventListener(
                    event,
                    this.refreshListener
                );
            }
        }
        this.textTrackList = null;
        this.refreshListener = null;
        this.trackIds = new WeakMap<TextTrack, number>();
        this.suppressedModes = new WeakMap<TextTrack, TextTrackMode>();
        this.nextTrackId = 0;
        this.subtitleOverride = null;
        this.active = false;
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
            this.applyOverride(tracks);
            return;
        }
        if (!tracks.some((entry) => entry.id === id)) {
            return;
        }

        this.subtitleOverride = id;
        this.applyOverride(tracks);
    }

    private readSubtitleTracks(): NativeSubtitleTrack[] {
        if (!this.active) {
            return [];
        }

        const result: NativeSubtitleTrack[] = [];
        try {
            const tracks = this.config.video.textTracks;
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
        if (!this.active) {
            return;
        }

        const tracks = this.readSubtitleTracks();
        if (this.subtitleOverride !== null) {
            this.applyOverride(tracks);
            return;
        }

        if (!this.config.showCaptions()) {
            for (const { track } of tracks) {
                if (track.mode !== 'showing') {
                    continue;
                }
                if (!this.suppressedModes.has(track)) {
                    this.suppressedModes.set(track, track.mode);
                }
                track.mode = 'hidden';
            }
            return;
        }

        for (const { track } of tracks) {
            const suppressedMode = this.suppressedModes.get(track);
            if (suppressedMode === undefined) {
                continue;
            }
            track.mode = suppressedMode;
            this.suppressedModes.delete(track);
        }
    }

    private applyOverride(tracks: NativeSubtitleTrack[]): void {
        for (const { id, track } of tracks) {
            track.mode =
                this.subtitleOverride !== -1 && id === this.subtitleOverride
                    ? 'showing'
                    : 'hidden';
        }
    }
}
