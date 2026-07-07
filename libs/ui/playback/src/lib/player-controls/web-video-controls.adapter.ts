import { Injectable, type Signal, computed, signal } from '@angular/core';
import {
    DEFAULT_ASPECT_PRESETS,
    DEFAULT_PLAYER_CAPABILITIES,
    DEFAULT_SPEED_PRESETS,
} from './player-controls-defaults';
import type {
    PlayerController,
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerStatus,
    PlayerTrack,
} from './player-controls.model';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';

/**
 * Engine-agnostic accessors a web engine injects so the adapter can read/select
 * audio & subtitle tracks without importing hls.js/videojs/artplayer.
 */
export interface WebVideoControlsOptions {
    getAudioTracks?: () => PlayerTrack[];
    setAudioTrack?: (id: number) => void;
    getSubtitleTracks?: () => PlayerTrack[];
    setSubtitleTrack?: (id: number) => void;
    isLive?: () => boolean;
    /**
     * Optional corrected duration source. Some engines (e.g. Video.js mpegts
     * raw-TS VOD) report the real duration on the player, not on the `<video>`
     * element — whose `duration` stays `Infinity` and would be misread as live.
     * When provided, the adapter prefers this over `video.duration`.
     */
    getDuration?: () => number;
}

/** readyState below which an actively-playing video is still buffering. */
const HAVE_FUTURE_DATA = 3;

interface WebVideoControlsContext {
    seriesNavigation: Signal<SeriesPlaybackNavigation | null>;
}

const VIDEO_EVENTS = [
    'play',
    'pause',
    'timeupdate',
    'durationchange',
    'volumechange',
    'ratechange',
    'loadedmetadata',
    'ended',
    'waiting',
    'playing',
    'error',
] as const;

/**
 * Bridges any `<video>`-backed web engine onto the generic
 * {@link PlayerController} contract consumed by `app-player-controls`. It binds
 * purely to DOM/video APIs (works in PWA — no window.electron), so the same
 * adapter drives Video.js, html5+hls.js and ArtPlayer. Track access is injected
 * via {@link WebVideoControlsOptions} to keep it engine-agnostic.
 */
@Injectable()
export class WebVideoControlsAdapter implements PlayerController {
    private video: HTMLVideoElement | null = null;
    private opts: WebVideoControlsOptions = {};
    private detachFn: (() => void) | null = null;

    /** Bumped on every media event to recompute the reactive state. */
    private readonly tick = signal(0);
    /**
     * Holds the host-supplied series-navigation signal reactively. Storing the
     * signal itself (rather than a one-time snapshot of its value) means updates
     * the host pushes AFTER {@link setContext} are reflected here.
     */
    private readonly seriesNavigationSource = signal<
        Signal<SeriesPlaybackNavigation | null>
    >(signal(null));
    private readonly seriesNavigation = computed(() =>
        this.seriesNavigationSource()()
    );

    readonly capabilities = computed<PlayerControlsCapabilities>(() => {
        this.tick();
        const hasAudioTracks = (this.opts.getAudioTracks?.().length ?? 0) > 1;
        const hasSubtitles = (this.opts.getSubtitleTracks?.().length ?? 0) > 0;
        return {
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: true,
            volume: true,
            playbackSpeed: true,
            fullscreen: true,
            audioTracks: hasAudioTracks,
            subtitles: hasSubtitles,
            aspectRatio: false,
            recording: false,
            seriesNavigation:
                !this.isLive() && this.seriesNavigation() !== null,
        };
    });

    readonly state = computed<PlayerControlsState>(() => {
        this.tick();
        const video = this.video;
        const isLive = this.isLive();
        const duration = this.normalizedDuration(isLive);
        const seriesNav = this.seriesNavigation();
        const seriesNavCapable = !isLive && seriesNav !== null;

        const audioTracks = this.opts.getAudioTracks?.() ?? [];
        const subtitleTracks = this.opts.getSubtitleTracks?.() ?? [];

        return {
            status: this.mapStatus(video),
            statusMessage: '',
            stalled: this.isStalled(video),
            positionSeconds: Math.max(0, video?.currentTime ?? 0),
            durationSeconds: duration,
            isLive,
            canSeek: !isLive && (duration ?? 0) > 0 && this.hasSeekable(video),
            volume: this.readVolume(video),
            audioTracks,
            subtitleTracks,
            subtitlesEnabled: subtitleTracks.some((track) => track.selected),
            playbackSpeed: video?.playbackRate ?? 1,
            speedPresets: DEFAULT_SPEED_PRESETS,
            aspectRatio: 'no',
            aspectPresets: DEFAULT_ASPECT_PRESETS,
            recording: { active: false, elapsedSeconds: 0, message: null },
            canPreviousEpisode:
                seriesNavCapable && seriesNav?.canPrevious === true,
            canNextEpisode: seriesNavCapable && seriesNav?.canNext === true,
        };
    });

    readonly commands: PlayerControlsCommands = {
        togglePlay: () => this.togglePlay(),
        seekTo: (seconds) => this.applyCurrentTime(seconds),
        seekBy: (delta) =>
            this.applyCurrentTime((this.video?.currentTime ?? 0) + delta),
        setVolume: (value) => this.applyVolume(value),
        setAudioTrack: (id) => this.opts.setAudioTrack?.(id),
        setSubtitleTrack: (id) => this.opts.setSubtitleTrack?.(id),
        setPlaybackSpeed: (speed) => this.applySpeed(speed),
        setAspectRatio: () => undefined,
        toggleRecording: () => undefined,
    };

    /** Binds to a `<video>` element and starts maintaining the state signal. */
    attach(video: HTMLVideoElement, opts: WebVideoControlsOptions = {}): void {
        this.detach();
        this.video = video;
        this.opts = opts;

        const onEvent = () => this.tick.update((value) => value + 1);
        for (const eventName of VIDEO_EVENTS) {
            video.addEventListener(eventName, onEvent);
        }
        this.detachFn = () => {
            for (const eventName of VIDEO_EVENTS) {
                video.removeEventListener(eventName, onEvent);
            }
        };
        // Prime the initial snapshot.
        onEvent();
    }

    /** Removes listeners and clears the bound element. Idempotent. */
    detach(): void {
        this.detachFn?.();
        this.detachFn = null;
        this.video = null;
    }

    /** Pushes reactive context (series navigation) used for capability gating. */
    setContext(context: WebVideoControlsContext): void {
        this.seriesNavigationSource.set(context.seriesNavigation);
    }

    private togglePlay(): void {
        const video = this.video;
        if (!video) {
            return;
        }
        if (video.paused || video.ended) {
            void video.play().catch(() => undefined);
        } else {
            video.pause();
        }
    }

    private applyCurrentTime(seconds: number): void {
        const video = this.video;
        if (!video) {
            return;
        }
        const duration = this.readDuration();
        const upperBound = Number.isFinite(duration) ? duration : seconds;
        video.currentTime = Math.max(0, Math.min(seconds, upperBound));
    }

    private applyVolume(value: number): void {
        const video = this.video;
        if (!video) {
            return;
        }
        const clamped = Math.max(0, Math.min(1, value));
        video.volume = clamped;
        video.muted = clamped <= 0;
    }

    private applySpeed(speed: number): void {
        if (this.video && Number.isFinite(speed) && speed > 0) {
            this.video.playbackRate = speed;
        }
    }

    private isLive(): boolean {
        if (this.opts.isLive) {
            return this.opts.isLive();
        }
        return !Number.isFinite(this.readDuration());
    }

    /**
     * Reads the corrected duration via {@link WebVideoControlsOptions.getDuration}
     * when supplied, falling back to the `<video>` element's own `duration`.
     */
    private readDuration(): number {
        if (this.opts.getDuration) {
            const duration = this.opts.getDuration();
            if (Number.isFinite(duration)) {
                return duration;
            }
        }
        return this.video?.duration ?? NaN;
    }

    /**
     * A video is only "stalled" when it is actively trying to play and lacks
     * future data; a normally paused VOD must not show a spinner.
     */
    private isStalled(video: HTMLVideoElement | null): boolean {
        if (!video || video.readyState === undefined) {
            return false;
        }
        return (
            !video.paused && !video.ended && video.readyState < HAVE_FUTURE_DATA
        );
    }

    private normalizedDuration(isLive: boolean): number | null {
        const duration = this.readDuration();
        if (isLive || !Number.isFinite(duration) || duration <= 0) {
            return null;
        }
        return duration;
    }

    private hasSeekable(video: HTMLVideoElement | null): boolean {
        try {
            return (video?.seekable?.length ?? 0) > 0;
        } catch {
            return false;
        }
    }

    private readVolume(video: HTMLVideoElement | null): number {
        if (!video) {
            return 1;
        }
        return video.muted ? 0 : video.volume;
    }

    private mapStatus(video: HTMLVideoElement | null): PlayerStatus {
        if (!video) {
            return 'idle';
        }
        if (video.error) {
            return 'error';
        }
        if (video.ended) {
            return 'ended';
        }
        if (video.paused) {
            // readyState 0/1 before any data → still warming up.
            return video.readyState < 2 ? 'loading' : 'paused';
        }
        return video.readyState < 3 ? 'loading' : 'playing';
    }
}
