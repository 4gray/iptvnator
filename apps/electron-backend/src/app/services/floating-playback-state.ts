import {
    playbackSeekWindow,
    type PlaybackSeekWindow,
} from '@iptvnator/shared/interfaces';

export interface FloatingPlaybackState extends PlaybackSeekWindow {
    paused: boolean;
    volume: number;
    isLive: boolean;
    position: number;
}

export function floatingPlaybackState(
    paused: boolean,
    volume: number,
    isLive: boolean,
    position: number,
    duration: number | null,
    seekable: boolean | undefined,
    ranges: { start: number; end: number }[] = []
): FloatingPlaybackState {
    return {
        paused,
        volume,
        isLive,
        position,
        ...playbackSeekWindow({ isLive, position, duration, seekable, ranges }),
    };
}
