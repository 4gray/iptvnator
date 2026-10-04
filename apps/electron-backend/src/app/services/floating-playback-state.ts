export interface FloatingPlaybackState {
    paused: boolean;
    volume: number;
    isLive: boolean;
    position: number;
    seekStart: number;
    seekEnd: number;
    canSeek: boolean;
}

export function floatingPlaybackState(
    paused: boolean,
    volume: number,
    isLive: boolean,
    position: number,
    duration: number | null,
    seekable: boolean,
    ranges: { start: number; end: number }[] = []
): FloatingPlaybackState {
    const state: FloatingPlaybackState = {
        paused,
        volume,
        isLive,
        position,
        seekStart: 0,
        seekEnd: 0,
        canSeek: false,
    };
    if (
        !isLive &&
        seekable &&
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration > 0
    ) {
        return { ...state, canSeek: true, seekEnd: duration };
    }
    if (isLive) {
        // Never join disjoint cache ranges or use estimated buffered duration.
        const range = ranges.find(
            (r) =>
                Number.isFinite(r.start) &&
                Number.isFinite(r.end) &&
                r.end > r.start &&
                r.start <= position &&
                r.end >= position
        );
        if (range)
            return {
                ...state,
                canSeek: true,
                seekStart: range.start,
                seekEnd: range.end,
            };
    }
    return state;
}
