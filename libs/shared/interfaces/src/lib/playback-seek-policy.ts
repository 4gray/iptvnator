import type { EmbeddedMpvSession } from './embedded-mpv-session.interface';
import type { ResolvedPortalPlayback } from './portal-playback.interface';

export interface PlaybackSeekWindow {
    canSeek: boolean;
    seekStart: number;
    seekEnd: number;
}

export interface PlaybackSeekInput {
    isLive: boolean;
    position: number;
    duration: number | null;
    seekable?: boolean;
    ranges?: readonly { start: number; end: number }[];
}

/** Pure policy: duration never proves live seekability, and cache holes stay holes. */
export function playbackSeekWindow(
    input: PlaybackSeekInput
): PlaybackSeekWindow {
    const unavailable = { canSeek: false, seekStart: 0, seekEnd: 0 };
    if (!Number.isFinite(input.position)) return unavailable;
    if (!input.isLive) {
        // Older MPV/frame-copy snapshots omit seekable. An explicit false wins.
        return input.seekable !== false &&
            input.duration !== null &&
            Number.isFinite(input.duration) &&
            input.duration > 0
            ? { canSeek: true, seekStart: 0, seekEnd: input.duration }
            : unavailable;
    }
    const range = input.ranges?.find(
        ({ start, end }) =>
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            start >= 0 &&
            end > start &&
            start <= input.position &&
            input.position <= end
    );
    return range
        ? { canSeek: true, seekStart: range.start, seekEnd: range.end }
        : unavailable;
}

export function clampPlaybackSeek(
    window: PlaybackSeekWindow,
    target: number
): number | null {
    return window.canSeek && Number.isFinite(target)
        ? Math.max(window.seekStart, Math.min(window.seekEnd, target))
        : null;
}

export function secondsBehindSeekEnd(
    window: PlaybackSeekWindow,
    position: number
): number {
    return window.canSeek && Number.isFinite(position)
        ? Math.max(0, window.seekEnd - position)
        : 0;
}

export function playbackIsLive(
    playback: Pick<ResolvedPortalPlayback, 'isLive' | 'contentInfo'>
): boolean {
    return playback.isLive ?? !playback.contentInfo;
}

export function embeddedMpvSeekWindow(
    session: EmbeddedMpvSession | null,
    playback: Pick<ResolvedPortalPlayback, 'isLive' | 'contentInfo'>
): PlaybackSeekWindow {
    return playbackSeekWindow({
        isLive: playbackIsLive(playback),
        position: session?.positionSeconds ?? 0,
        duration: session?.durationSeconds ?? null,
        seekable: session?.seekable,
        ranges: session?.seekableRanges,
    });
}
