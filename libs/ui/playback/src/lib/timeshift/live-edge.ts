const DEFAULT_LIVE_EDGE_OFFSET_SECONDS = 0.25;

export function getMediaLiveEdge(
    media: Pick<HTMLMediaElement, 'duration' | 'seekable'>
): number | undefined {
    const { seekable } = media;
    if (seekable.length > 0) {
        const seekableEnd = seekable.end(seekable.length - 1);
        if (Number.isFinite(seekableEnd)) {
            return Math.max(0, seekableEnd);
        }
    }

    return Number.isFinite(media.duration) && media.duration >= 0
        ? media.duration
        : undefined;
}

// hls.js keeps the live playhead ~3 target durations (12s with 4s segments)
// behind the playlist end, and Video.js' liveTracker uses a 15s tolerance.
// Anything within this window is considered "playing live".
export const DEFAULT_LIVE_EDGE_TOLERANCE_SECONDS = 15;

export function isMediaAtLiveEdge(
    media: Pick<
        HTMLMediaElement,
        'currentTime' | 'duration' | 'paused' | 'seekable'
    >,
    toleranceSeconds = DEFAULT_LIVE_EDGE_TOLERANCE_SECONDS
): boolean {
    if (media.paused) {
        return false;
    }
    const liveEdge = getMediaLiveEdge(media);
    if (liveEdge === undefined) {
        return true;
    }
    return liveEdge - media.currentTime <= Math.max(0, toleranceSeconds);
}

const LIVE_EDGE_OBSERVER_EVENTS = [
    'timeupdate',
    'play',
    'playing',
    'pause',
    'seeked',
    'loadedmetadata',
    'emptied',
] as const;

/**
 * Watches a media element and reports whether playback is at the live edge.
 * Returns a dispose function that removes all listeners.
 */
export function observeMediaLiveEdge(
    media: HTMLMediaElement,
    onChange: (atLiveEdge: boolean) => void
): () => void {
    const update = () => onChange(isMediaAtLiveEdge(media));
    for (const event of LIVE_EDGE_OBSERVER_EVENTS) {
        media.addEventListener(event, update);
    }
    update();
    return () => {
        for (const event of LIVE_EDGE_OBSERVER_EVENTS) {
            media.removeEventListener(event, update);
        }
    };
}

export function seekMediaToLiveEdge(
    media: HTMLMediaElement,
    offsetSeconds = DEFAULT_LIVE_EDGE_OFFSET_SECONDS
): boolean {
    const liveEdge = getMediaLiveEdge(media);
    if (liveEdge === undefined) {
        return false;
    }

    media.currentTime = Math.max(0, liveEdge - Math.max(0, offsetSeconds));
    void media.play().catch(() => undefined);
    return true;
}
