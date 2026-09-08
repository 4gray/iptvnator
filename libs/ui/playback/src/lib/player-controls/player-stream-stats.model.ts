/**
 * Live technical data about the stream that is playing right now, shown in the
 * controls' stream-info popover.
 *
 * Every field is nullable and independently optional: engines report wildly
 * different subsets (a `<video>` element knows its frame counters but not the
 * container, mpv knows the codec but has no notion of "total frames"), and a
 * row is simply omitted when its value is unknown rather than rendered as a
 * fake zero.
 */
export interface PlayerStreamStats {
    /** Displayed video size in pixels (mpv `dwidth`/`dheight`). */
    width: number | null;
    height: number | null;
    /** Measured playback frame rate, not the container's nominal rate. */
    fps: number | null;
    /** Video bitrate in bits per second. */
    videoBitrateBps: number | null;
    /** Audio bitrate in bits per second. */
    audioBitrateBps: number | null;
    /** Engine-reported codec names, e.g. `h264` / `avc1.640028`. */
    videoCodec: string | null;
    audioCodec: string | null;
    /**
     * Channel layout as the engine names it: a count (`6`) from web engines,
     * a layout string (`5.1`, `stereo`) from mpv.
     */
    audioChannels: string | number | null;
    /** Audio sampling rate in Hz. */
    audioSampleRateHz: number | null;
    /** Container/format name, e.g. `mpegts` or `hls`. */
    container: string | null;
    /** Media buffered ahead of the playhead, in seconds. */
    bufferedAheadSeconds: number | null;
    /** Frames dropped since playback started. */
    droppedFrames: number | null;
    /** Frames presented since playback started; pairs with `droppedFrames`. */
    totalFrames: number | null;
}

/**
 * Pull-based stats provider an engine adapter exposes on its
 * {@link PlayerController}.
 *
 * Pull rather than push on purpose: the numbers move continuously (bitrate and
 * buffer change every second), and folding them into `PlayerControlsState`
 * would re-run every derived control signal on every tick even while nobody is
 * looking at them. The controls sample this only while the popover is open.
 */
export interface PlayerStreamStatsSource {
    /**
     * Reads a fresh snapshot. Called on a ~1s cadence while the popover is
     * open, so implementations must be cheap and side-effect free apart from
     * their own sampling bookkeeping (frame-rate deltas).
     */
    sample(): PlayerStreamStats | null;
}

/** True when at least one field carries a usable value. */
export function hasStreamStatsData(
    stats: PlayerStreamStats | null | undefined
): boolean {
    if (!stats) {
        return false;
    }

    return Object.values(stats).some((value) =>
        typeof value === 'number' ? Number.isFinite(value) : Boolean(value)
    );
}
