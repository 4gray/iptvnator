/** Internal metadata lives alongside, and is never exported with, playlist positions. */
const resetKey = '__iptvnator_native_playback_resets__';
export const nativePlaybackEpisodeResetKey =
    '__iptvnator_native_playback_episode_resets__';

export function nativePlaybackResetAt(
    positions: Record<string, unknown>,
    ...keys: string[]
): number {
    const resets = positions[resetKey] as Record<string, number> | undefined;
    return Math.max(0, ...keys.map((key) => resets?.[key] ?? 0));
}

export function stampNativePlaybackReset(
    positions: Record<string, unknown>,
    ...keys: string[]
): void {
    if (!('TvShell' in globalThis) || !keys.length) return;
    const resets = { ...(positions[resetKey] as Record<string, number>) };
    const timestamp = Date.now();
    for (const key of keys) resets[key] = timestamp;
    positions[resetKey] = resets;
}

export function stampNativePlaybackPlaylistReset(
    positions: Record<string, unknown>,
    playlistId: string
): void {
    if (!('TvShell' in globalThis)) return;
    const prefix = JSON.stringify([playlistId]).slice(0, -1) + ',';
    const resets = positions[resetKey] as Record<string, number> | undefined;
    for (const key in resets) if (key.startsWith(prefix)) delete resets[key];
    const episodeResets = positions[nativePlaybackEpisodeResetKey] as
        Record<string, unknown> | undefined;
    if (episodeResets) delete episodeResets[playlistId];
    stampNativePlaybackReset(positions, playlistId);
}
