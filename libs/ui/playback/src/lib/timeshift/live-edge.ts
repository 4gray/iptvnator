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
