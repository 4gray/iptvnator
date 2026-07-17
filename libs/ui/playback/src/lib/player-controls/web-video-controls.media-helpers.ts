import type { PlayerStatus } from './player-controls.model';

const HAVE_FUTURE_DATA = 3;
const NETWORK_EMPTY = 0;

export interface WebVideoMetadataOptions {
    isLive?: () => boolean;
    /**
     * Optional corrected duration source. Some engines (e.g. Video.js mpegts
     * raw-TS VOD) report the real duration on the player, not on the `<video>`
     * element — whose `duration` stays `Infinity` and would be misread as live.
     * Every returned value except `NaN` is authoritative; `NaN` falls back to
     * `video.duration`.
     */
    getDuration?: () => number;
}

export const WEB_VIDEO_EVENTS = [
    'loadstart',
    'emptied',
    'progress',
    'stalled',
    'seeking',
    'seeked',
    'play',
    'pause',
    'timeupdate',
    'durationchange',
    'volumechange',
    'ratechange',
    'loadedmetadata',
    'loadeddata',
    'canplay',
    'ended',
    'waiting',
    'playing',
    'error',
    'enterpictureinpicture',
    'leavepictureinpicture',
] as const;

export function toggleVideoPlay(video: HTMLVideoElement | null): void {
    if (!video) {
        return;
    }
    if (video.paused || video.ended) {
        void video.play().catch(() => undefined);
    } else {
        video.pause();
    }
}

export function applyVideoCurrentTime(
    video: HTMLVideoElement | null,
    seconds: number,
    getDuration: () => number
): void {
    if (!video || !Number.isFinite(seconds)) {
        return;
    }
    const duration = getDuration();
    const upperBound = Number.isFinite(duration) ? duration : seconds;
    try {
        video.currentTime = Math.max(0, Math.min(seconds, upperBound));
    } catch {
        // Some media implementations reject writes while changing source.
    }
}

export function applyVideoVolume(
    video: HTMLVideoElement | null,
    value: number
): void {
    if (!video || !Number.isFinite(value)) {
        return;
    }
    const clamped = Math.max(0, Math.min(1, value));
    try {
        video.volume = clamped;
        video.muted = clamped <= 0;
    } catch {
        // Ignore transient native media setter failures.
    }
}

export function applyVideoSpeed(
    video: HTMLVideoElement | null,
    speed: number
): void {
    if (video && Number.isFinite(speed) && speed > 0) {
        try {
            video.playbackRate = speed;
        } catch {
            // Ignore transient native media setter failures.
        }
    }
}

export function applyTrackSelection(
    setter: ((id: number) => void | Promise<void>) | undefined,
    id: number,
    refresh: () => void
): void {
    if (!setter) {
        return;
    }
    try {
        const result = setter(id);
        if (result) {
            void result.then(refresh, () => undefined);
            return;
        }
        refresh();
    } catch {
        // Engine adapters may reject selection while changing source.
    }
}

export function isVideoStalled(video: HTMLVideoElement | null): boolean {
    if (!video || video.readyState === undefined) {
        return false;
    }
    return !video.paused && !video.ended && video.readyState < HAVE_FUTURE_DATA;
}

export function normalizeVideoDuration(
    duration: number,
    isLive: boolean
): number | null {
    if (isLive || !Number.isFinite(duration) || duration <= 0) {
        return null;
    }
    return duration;
}

export function hasSeekableRange(video: HTMLVideoElement | null): boolean {
    try {
        return (video?.seekable?.length ?? 0) > 0;
    } catch {
        return false;
    }
}

export function readVideoVolume(video: HTMLVideoElement | null): number {
    if (!video) {
        return 1;
    }
    return video.muted ? 0 : video.volume;
}

export function readVideoDuration(
    video: HTMLVideoElement | null,
    options: WebVideoMetadataOptions
): number {
    if (options.getDuration) {
        const duration = options.getDuration();
        if (!Number.isNaN(duration)) {
            return duration;
        }
    }
    return video?.duration ?? NaN;
}

export function readVideoIsLive(
    video: HTMLVideoElement | null,
    options: WebVideoMetadataOptions
): boolean {
    return options.isLive
        ? options.isLive()
        : readVideoDuration(video, options) === Number.POSITIVE_INFINITY;
}

export function mapVideoStatus(video: HTMLVideoElement | null): PlayerStatus {
    if (!video) {
        return 'idle';
    }
    if (video.error) {
        return 'error';
    }
    if (video.ended) {
        return 'ended';
    }
    if (video.networkState === NETWORK_EMPTY) {
        return 'idle';
    }
    if (video.paused) {
        return 'paused';
    }
    return video.readyState < HAVE_FUTURE_DATA ? 'loading' : 'playing';
}
