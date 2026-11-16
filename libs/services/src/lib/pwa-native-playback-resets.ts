/** Internal metadata lives alongside, and is never exported with, playlist positions. */
export const nativePlaybackResetKey = '__iptvnator_native_playback_resets__';
export const nativePlaybackEpisodeResetKey =
    '__iptvnator_native_playback_episode_resets__';

declare global {
    interface Window {
        /** Undefined before confirmation, a request ID while pending, null when idle. */
        iptvnatorAndroidCheckpointRequestId?: string | null;
    }
}

export function nativePlaybackMayHaveCheckpoint(): boolean {
    return (
        'TvShell' in globalThis &&
        globalThis.window?.iptvnatorAndroidCheckpointRequestId !== null
    );
}

export function nativePlaybackResetAt(
    positions: Record<string, unknown>,
    ...keys: string[]
): number {
    const resets = positions[nativePlaybackResetKey] as
        Record<string, number> | undefined;
    return Math.max(0, ...keys.map((key) => resets?.[key] ?? 0));
}

export function stampNativePlaybackReset(
    positions: Record<string, unknown>,
    ...keys: string[]
): void {
    if (!keys.length || !nativePlaybackMayHaveCheckpoint()) return;
    const resets = {
        ...(positions[nativePlaybackResetKey] as Record<string, number>),
    };
    const timestamp = Date.now();
    for (const key of keys) resets[key] = timestamp;
    positions[nativePlaybackResetKey] = resets;
}

export function stampNativePlaybackPlaylistReset(
    positions: Record<string, unknown>,
    playlistId: string
): void {
    if (!('TvShell' in globalThis)) return;
    const prefix = JSON.stringify([playlistId]).slice(0, -1) + ',';
    const resets = positions[nativePlaybackResetKey] as
        Record<string, number> | undefined;
    for (const key in resets) if (key.startsWith(prefix)) delete resets[key];
    const episodeResets = positions[nativePlaybackEpisodeResetKey] as
        Record<string, unknown> | undefined;
    if (episodeResets) delete episodeResets[playlistId];
    stampNativePlaybackReset(positions, playlistId);
}
