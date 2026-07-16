/* eslint-disable max-lines */
import Hls from 'hls.js';
import type { PlayerTrack } from '../player-controls/player-controls.model';
import type { WebVideoControlsAdapter } from '../player-controls/web-video-controls.adapter';

export type HtmlVideoControlsSource =
    | { kind: 'native' }
    | { kind: 'mpegts' }
    | { kind: 'hls'; hls: Hls };

export interface HtmlVideoPlayerControlsBridgeConfig {
    video: HTMLVideoElement;
    adapter: WebVideoControlsAdapter;
    isLive: () => boolean;
    showCaptions: () => boolean;
}

const HLS_REFRESH_EVENTS = [
    Hls.Events.AUDIO_TRACKS_UPDATED,
    Hls.Events.AUDIO_TRACK_SWITCHING,
    Hls.Events.AUDIO_TRACK_SWITCHED,
    Hls.Events.SUBTITLE_TRACKS_UPDATED,
    Hls.Events.SUBTITLE_TRACKS_CLEARED,
    Hls.Events.SUBTITLE_TRACK_SWITCH,
    Hls.Events.MANIFEST_LOADING,
] as const;

const NATIVE_TRACK_EVENTS = ['addtrack', 'removetrack', 'change'] as const;

export class HtmlVideoPlayerControlsBridge {
    private source: HtmlVideoControlsSource | null = null;
    private hlsRefreshListener: (() => void) | null = null;
    private nativeTextTrackList: TextTrackList | null = null;
    private nativeTrackRefreshListener: EventListener | null = null;
    private nativeTrackIds = new WeakMap<TextTrack, number>();
    private suppressedNativeModes = new WeakMap<TextTrack, TextTrackMode>();
    private nextNativeTrackId = 0;
    private subtitleOverride: number | null = null;
    private suppressedHlsSubtitleTrack: number | null = null;
    private attached = false;
    private destroyed = false;

    constructor(private readonly config: HtmlVideoPlayerControlsBridgeConfig) {}

    attach(): void {
        if (this.attached || this.destroyed) {
            return;
        }

        this.config.adapter.attach(this.config.video, {
            isLive: this.config.isLive,
            getDuration: () => this.readDuration(),
            getAudioTracks: () => this.getAudioTracks(),
            setAudioTrack: (id) => this.setAudioTrack(id),
            getSubtitleTracks: () => this.getSubtitleTracks(),
            setSubtitleTrack: (id) => this.setSubtitleTrack(id),
        });
        this.attached = true;
    }

    setSource(source: HtmlVideoControlsSource): void {
        if (this.destroyed) {
            return;
        }
        this.removeSourceListeners();
        this.resetSourceState();
        this.source = source;
        this.addSourceListeners();
        this.applyCaptionState();
        this.config.adapter.refresh();
    }

    refreshInputs(): void {
        if (!this.destroyed) {
            this.applyCaptionState();
            this.config.adapter.refresh();
        }
    }

    clearSource(): void {
        if (this.destroyed) {
            return;
        }
        this.removeSourceListeners();
        this.source = null;
        this.resetSourceState();
        this.config.adapter.refresh();
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.clearSource();
        if (this.attached) {
            this.config.adapter.detach();
            this.attached = false;
        }
        this.destroyed = true;
    }

    private readDuration(): number {
        if (this.source?.kind !== 'mpegts' || this.config.isLive()) {
            return NaN;
        }

        const videoDuration = this.readFinitePositive(() => {
            return this.config.video.duration;
        });
        if (!Number.isNaN(videoDuration)) {
            return videoDuration;
        }

        const seekableEnd = this.readLastFinitePositiveEnd(() => {
            return this.config.video.seekable;
        });
        if (!Number.isNaN(seekableEnd)) {
            return seekableEnd;
        }

        return this.readLastFinitePositiveEnd(() => {
            return this.config.video.buffered;
        });
    }

    private getAudioTracks(): PlayerTrack[] {
        if (this.source?.kind !== 'hls') {
            return [];
        }

        const hls = this.source.hls;
        return hls.audioTracks.map((track, index) => ({
            id: index,
            label: track.name || track.lang || `Audio ${index + 1}`,
            selected: index === hls.audioTrack,
        }));
    }

    private setAudioTrack(id: number): void {
        if (this.source?.kind !== 'hls') {
            return;
        }

        const hls = this.source.hls;
        if (Number.isInteger(id) && id >= 0 && id < hls.audioTracks.length) {
            hls.audioTrack = id;
        }
    }

    private getSubtitleTracks(): PlayerTrack[] {
        if (this.source?.kind === 'hls') {
            const hls = this.source.hls;
            return hls.subtitleTracks.map((track, index) => ({
                id: index,
                label: track.name || track.lang || `Subtitle ${index + 1}`,
                selected:
                    hls.subtitleDisplay === true && index === hls.subtitleTrack,
            }));
        }
        if (!this.usesNativeTextTracks()) {
            return [];
        }

        return this.readNativeSubtitleTracks().map(({ id, track }) => ({
            id,
            label: track.label || track.language || `Subtitle ${id + 1}`,
            selected: track.mode === 'showing',
        }));
    }

    private setSubtitleTrack(id: number): void {
        if (!Number.isInteger(id)) {
            return;
        }

        if (this.source?.kind === 'hls') {
            const hls = this.source.hls;
            if (id === -1) {
                this.subtitleOverride = -1;
                this.suppressedHlsSubtitleTrack = null;
                this.setHlsSubtitleTrack(hls, -1);
                this.setHlsSubtitleDisplay(hls, false);
                return;
            }
            if (id < 0 || id >= hls.subtitleTracks.length) {
                return;
            }

            this.subtitleOverride = id;
            this.suppressedHlsSubtitleTrack = null;
            this.setHlsSubtitleDisplay(hls, true);
            this.setHlsSubtitleTrack(hls, id);
            return;
        }

        if (!this.usesNativeTextTracks()) {
            return;
        }

        const tracks = this.readNativeSubtitleTracks();
        if (id === -1) {
            this.subtitleOverride = -1;
            this.applyNativeOverride(tracks);
            return;
        }
        if (!tracks.some((entry) => entry.id === id)) {
            return;
        }

        this.subtitleOverride = id;
        this.applyNativeOverride(tracks);
    }

    private addSourceListeners(): void {
        if (this.source?.kind === 'hls') {
            const hls = this.source.hls;
            const refresh = () => {
                this.applyHlsCaptionState();
                this.config.adapter.refresh();
            };
            this.hlsRefreshListener = refresh;
            for (const event of HLS_REFRESH_EVENTS) {
                hls.on(event, refresh);
            }
            return;
        }
        if (!this.usesNativeTextTracks()) {
            return;
        }

        const textTracks = this.config.video.textTracks;
        if (typeof textTracks.addEventListener !== 'function') {
            return;
        }
        const refresh: EventListener = () => {
            this.applyNativeCaptionState();
            this.config.adapter.refresh();
        };
        this.nativeTextTrackList = textTracks;
        this.nativeTrackRefreshListener = refresh;
        for (const event of NATIVE_TRACK_EVENTS) {
            textTracks.addEventListener(event, refresh);
        }
    }

    private removeSourceListeners(): void {
        if (this.source?.kind === 'hls' && this.hlsRefreshListener) {
            const hls = this.source.hls;
            const refresh = this.hlsRefreshListener;
            for (const event of HLS_REFRESH_EVENTS) {
                hls.off(event, refresh);
            }
        }
        this.hlsRefreshListener = null;

        if (
            this.nativeTextTrackList &&
            this.nativeTrackRefreshListener &&
            typeof this.nativeTextTrackList.removeEventListener === 'function'
        ) {
            const textTracks = this.nativeTextTrackList;
            const refresh = this.nativeTrackRefreshListener;
            for (const event of NATIVE_TRACK_EVENTS) {
                textTracks.removeEventListener(event, refresh);
            }
        }
        this.nativeTextTrackList = null;
        this.nativeTrackRefreshListener = null;
    }

    private usesNativeTextTracks(): boolean {
        return this.source?.kind === 'native' || this.source?.kind === 'mpegts';
    }

    private readNativeSubtitleTracks(): Array<{
        id: number;
        track: TextTrack;
    }> {
        if (!this.usesNativeTextTracks()) {
            return [];
        }

        const result: Array<{ id: number; track: TextTrack }> = [];
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

                let id = this.nativeTrackIds.get(track);
                if (id === undefined) {
                    id = this.nextNativeTrackId;
                    this.nextNativeTrackId += 1;
                    this.nativeTrackIds.set(track, id);
                }
                result.push({ id, track });
            }
        } catch {
            return [];
        }
        return result;
    }

    private applyCaptionState(): void {
        this.applyHlsCaptionState();
        this.applyNativeCaptionState();
    }

    private applyHlsCaptionState(): void {
        if (this.source?.kind !== 'hls') {
            return;
        }

        const hls = this.source.hls;
        if (this.subtitleOverride !== null) {
            if (this.subtitleOverride === -1) {
                this.setHlsSubtitleTrack(hls, -1);
                this.setHlsSubtitleDisplay(hls, false);
                return;
            }
            if (this.subtitleOverride < hls.subtitleTracks.length) {
                this.setHlsSubtitleDisplay(hls, true);
                this.setHlsSubtitleTrack(hls, this.subtitleOverride);
            } else {
                this.setHlsSubtitleDisplay(hls, false);
            }
            return;
        }

        if (!this.config.showCaptions()) {
            if (
                Number.isInteger(hls.subtitleTrack) &&
                hls.subtitleTrack >= 0 &&
                hls.subtitleTrack < hls.subtitleTracks.length
            ) {
                this.suppressedHlsSubtitleTrack = hls.subtitleTrack;
            }
            this.setHlsSubtitleDisplay(hls, false);
            return;
        }

        const suppressedTrack = this.suppressedHlsSubtitleTrack;
        if (
            suppressedTrack !== null &&
            suppressedTrack < hls.subtitleTracks.length
        ) {
            this.suppressedHlsSubtitleTrack = null;
            this.setHlsSubtitleDisplay(hls, true);
            this.setHlsSubtitleTrack(hls, suppressedTrack);
        }
    }

    private setHlsSubtitleTrack(hls: Hls, id: number): void {
        if (hls.subtitleTrack !== id) {
            hls.subtitleTrack = id;
        }
    }

    private setHlsSubtitleDisplay(hls: Hls, display: boolean): void {
        if (hls.subtitleDisplay !== display) {
            hls.subtitleDisplay = display;
        }
    }

    private applyNativeCaptionState(): void {
        if (!this.usesNativeTextTracks()) {
            return;
        }

        const tracks = this.readNativeSubtitleTracks();
        if (this.subtitleOverride !== null) {
            this.applyNativeOverride(tracks);
            return;
        }

        if (!this.config.showCaptions()) {
            for (const { track } of tracks) {
                if (track.mode !== 'showing') {
                    continue;
                }
                if (!this.suppressedNativeModes.has(track)) {
                    this.suppressedNativeModes.set(track, track.mode);
                }
                track.mode = 'hidden';
            }
            return;
        }

        for (const { track } of tracks) {
            const suppressedMode = this.suppressedNativeModes.get(track);
            if (suppressedMode === undefined) {
                continue;
            }
            track.mode = suppressedMode;
            this.suppressedNativeModes.delete(track);
        }
    }

    private applyNativeOverride(
        tracks: Array<{ id: number; track: TextTrack }>
    ): void {
        for (const { id, track } of tracks) {
            track.mode =
                this.subtitleOverride !== -1 && id === this.subtitleOverride
                    ? 'showing'
                    : 'hidden';
        }
    }

    private resetSourceState(): void {
        this.nativeTrackIds = new WeakMap<TextTrack, number>();
        this.suppressedNativeModes = new WeakMap<TextTrack, TextTrackMode>();
        this.nextNativeTrackId = 0;
        this.subtitleOverride = null;
        this.suppressedHlsSubtitleTrack = null;
    }

    private readFinitePositive(read: () => number): number {
        try {
            const value = read();
            return Number.isFinite(value) && value > 0 ? value : NaN;
        } catch {
            return NaN;
        }
    }

    private readLastFinitePositiveEnd(read: () => TimeRanges): number {
        try {
            const ranges = read();
            for (let index = ranges.length - 1; index >= 0; index -= 1) {
                const end = ranges.end(index);
                if (Number.isFinite(end) && end > 0) {
                    return end;
                }
            }
        } catch {
            return NaN;
        }
        return NaN;
    }
}
