import { Injectable, type Signal, computed, signal } from '@angular/core';
import {
    createEmptyControlsState,
    DEFAULT_ASPECT_PRESETS,
    DEFAULT_PLAYER_CAPABILITIES,
    DEFAULT_SPEED_PRESETS,
} from './player-controls-defaults';
import type {
    PlayerController,
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
    PlayerTrack,
} from './player-controls.model';
import type { SeriesPlaybackNavigation } from '../portal-inline-player/series-playback-navigation';
import {
    applyTrackSelection,
    applyVideoCurrentTime,
    applyVideoSpeed,
    applyVideoVolume,
    hasSeekableRange,
    isVideoStalled,
    mapVideoStatus,
    normalizeVideoDuration,
    readVideoDuration,
    readVideoIsLive,
    readVideoVolume,
    toggleVideoPlay,
    type WebVideoMetadataOptions,
    WEB_VIDEO_EVENTS,
} from './web-video-controls.media-helpers';
import { WebVideoPictureInPictureController } from './web-video-picture-in-picture.controller';

/**
 * Engine-agnostic accessors a web engine injects so the adapter can read/select
 * audio & subtitle tracks without importing hls.js/videojs/artplayer.
 */
export interface WebVideoControlsOptions extends WebVideoMetadataOptions {
    getAudioTracks?: () => PlayerTrack[];
    setAudioTrack?: (id: number) => void | Promise<void>;
    getSubtitleTracks?: () => PlayerTrack[];
    setSubtitleTrack?: (id: number) => void | Promise<void>;
}

interface WebVideoControlsContext {
    seriesNavigation: Signal<SeriesPlaybackNavigation | null>;
}

/**
 * Can bridge any `<video>`-backed web engine onto the generic
 * {@link PlayerController} contract using only DOM/video APIs.
 */
@Injectable()
export class WebVideoControlsAdapter implements PlayerController {
    private video: HTMLVideoElement | null = null;
    private opts: WebVideoControlsOptions = {};
    private detachFn: (() => void) | null = null;
    private bindingGeneration = 0;

    /** Bumped whenever DOM or engine-specific state must be re-read. */
    private readonly tick = signal(0);
    private readonly pictureInPicture = new WebVideoPictureInPictureController(
        () => ({
            generation: this.bindingGeneration,
            video: this.video,
        }),
        () => this.refresh()
    );
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
        if (!this.video) {
            return DEFAULT_PLAYER_CAPABILITIES;
        }

        const hasAudioTracks =
            typeof this.opts.setAudioTrack === 'function' &&
            (this.opts.getAudioTracks?.().length ?? 0) > 1;
        const hasSubtitles =
            typeof this.opts.setSubtitleTrack === 'function' &&
            (this.opts.getSubtitleTracks?.().length ?? 0) > 0;
        const isLive = readVideoIsLive(this.video, this.opts);
        const pictureInPicture = this.pictureInPicture.snapshot();
        return {
            ...DEFAULT_PLAYER_CAPABILITIES,
            seek: !isLive,
            volume: true,
            playbackSpeed: true,
            fullscreen: true,
            audioTracks: hasAudioTracks,
            subtitles: hasSubtitles,
            aspectRatio: false,
            recording: false,
            pictureInPicture: pictureInPicture.supported,
            seriesNavigation: !isLive && this.seriesNavigation() !== null,
        };
    });

    readonly state = computed<PlayerControlsState>(() => {
        this.tick();
        const video = this.video;
        if (!video) {
            return createEmptyControlsState();
        }

        const isLive = readVideoIsLive(video, this.opts);
        const duration = normalizeVideoDuration(
            readVideoDuration(video, this.opts),
            isLive
        );
        const seriesNav = this.seriesNavigation();
        const seriesNavCapable = !isLive && seriesNav !== null;

        const audioTracks = this.opts.getAudioTracks?.() ?? [];
        const subtitleTracks = this.opts.getSubtitleTracks?.() ?? [];
        const pictureInPicture = this.pictureInPicture.snapshot();

        return {
            status: mapVideoStatus(video),
            statusMessage: '',
            stalled: isVideoStalled(video),
            positionSeconds: Math.max(0, video?.currentTime ?? 0),
            durationSeconds: duration,
            isLive,
            canSeek: !isLive && (duration ?? 0) > 0 && hasSeekableRange(video),
            volume: readVideoVolume(video),
            audioTracks,
            subtitleTracks,
            subtitlesEnabled: subtitleTracks.some((track) => track.selected),
            playbackSpeed: video?.playbackRate ?? 1,
            speedPresets: DEFAULT_SPEED_PRESETS,
            aspectRatio: 'no',
            aspectPresets: DEFAULT_ASPECT_PRESETS,
            recording: { active: false, elapsedSeconds: 0, message: null },
            pictureInPictureActive: pictureInPicture.active,
            canPictureInPicture: pictureInPicture.canToggle,
            canPreviousEpisode:
                seriesNavCapable && seriesNav?.canPrevious === true,
            canNextEpisode: seriesNavCapable && seriesNav?.canNext === true,
        };
    });

    readonly commands: PlayerControlsCommands = {
        togglePlay: () => toggleVideoPlay(this.video),
        seekTo: (seconds) =>
            applyVideoCurrentTime(this.video, seconds, () =>
                readVideoDuration(this.video, this.opts)
            ),
        seekBy: (delta) =>
            applyVideoCurrentTime(
                this.video,
                (this.video?.currentTime ?? 0) + delta,
                () => readVideoDuration(this.video, this.opts)
            ),
        setVolume: (value) => applyVideoVolume(this.video, value),
        setAudioTrack: (id) =>
            applyTrackSelection(this.opts.setAudioTrack, id, () =>
                this.refresh()
            ),
        setSubtitleTrack: (id) =>
            applyTrackSelection(this.opts.setSubtitleTrack, id, () =>
                this.refresh()
            ),
        setPlaybackSpeed: (speed) => applyVideoSpeed(this.video, speed),
        setAspectRatio: () => undefined,
        toggleRecording: () => undefined,
        togglePictureInPicture: () => this.pictureInPicture.toggle(),
    };

    /** Binds to a `<video>` element and starts maintaining the state signal. */
    attach(video: HTMLVideoElement, opts: WebVideoControlsOptions = {}): void {
        this.detach();
        const generation = this.bindingGeneration;
        this.video = video;
        this.opts = opts;

        const onEvent = () => {
            if (this.video === video && this.bindingGeneration === generation) {
                this.refresh();
            }
        };
        for (const eventName of WEB_VIDEO_EVENTS) {
            video.addEventListener(eventName, onEvent);
        }
        this.detachFn = () => {
            for (const eventName of WEB_VIDEO_EVENTS) {
                video.removeEventListener(eventName, onEvent);
            }
        };
        // Prime the initial snapshot.
        onEvent();
    }

    /**
     * Invalidates cached state/capabilities after an engine-specific getter
     * changes without emitting a native media event (for example tracks,
     * corrected duration, or live/VOD classification).
     */
    refresh(): void {
        this.tick.update((value) => value + 1);
    }

    /** Removes listeners and clears the bound element. Idempotent. */
    detach(): void {
        const previousVideo = this.video;
        this.bindingGeneration += 1;
        this.detachFn?.();
        this.detachFn = null;
        this.video = null;
        this.opts = {};
        this.pictureInPicture.release(previousVideo);
        this.refresh();
    }

    /** Pushes reactive context (series navigation) used for capability gating. */
    setContext(context: WebVideoControlsContext): void {
        this.seriesNavigationSource.set(context.seriesNavigation);
    }
}
