/** Internal metadata lives alongside, and is never exported with, playlist positions. */
const resetKey = '__iptvnator_native_playback_resets__';
type ResetMarkers = Record<string, number | Record<string, number>>;

const episodeKey = (playlistId: string) =>
    JSON.stringify([playlistId, 'episodes']);

export function nativePlaybackResetAt(
    positions: Record<string, unknown>,
    ...keys: string[]
): number {
    const resets = positions[resetKey] as ResetMarkers | undefined;
    return Math.max(
        0,
        ...keys.map((key) => {
            const value = resets?.[key];
            return typeof value === 'number' ? value : 0;
        })
    );
}

export function stampNativePlaybackReset(
    positions: Record<string, unknown>,
    ...keys: string[]
): void {
    if (!('TvShell' in globalThis) || !keys.length) return;
    const resets = { ...(positions[resetKey] as ResetMarkers) };
    const timestamp = Date.now();
    for (const key of keys) resets[key] = timestamp;
    positions[resetKey] = resets;
}

export function nativePlaybackEpisodeResetAt(
    positions: Record<string, unknown>,
    playlistId: string,
    episodeId: number
): number {
    const resets = positions[resetKey] as ResetMarkers | undefined;
    const batches = resets?.[episodeKey(playlistId)];
    if (!batches || typeof batches === 'number') return 0;
    let latest = 0;
    for (const [key, timestamp] of Object.entries(batches)) {
        if (timestamp <= latest) continue;
        const ranges = key.split(',').map(Number);
        for (let index = 0; index < ranges.length; index += 2) {
            if (episodeId >= ranges[index] && episodeId <= ranges[index + 1]) {
                latest = timestamp;
                break;
            }
        }
    }
    return latest;
}

export function stampNativePlaybackEpisodeResets(
    positions: Record<string, unknown>,
    playlistId: string,
    episodeIds: number[]
): void {
    if (!('TvShell' in globalThis) || !episodeIds.length) return;
    // Adjacent IDs share one range so a bulk clear can free space at quota.
    const ranges: number[] = [];
    for (const id of [...new Set(episodeIds)].sort((a, b) => a - b)) {
        if (ranges.length && id === ranges[ranges.length - 1] + 1)
            ranges[ranges.length - 1] = id;
        else ranges.push(id, id);
    }
    const resets = { ...(positions[resetKey] as ResetMarkers) };
    const key = episodeKey(playlistId);
    const previous = resets[key];
    resets[key] = {
        ...(typeof previous === 'object' ? previous : {}),
        [ranges.join(',')]: Date.now(),
    };
    positions[resetKey] = resets;
}
