import type { UserDataStorage } from './user-data-storage';
import { XTREAM_USER_DATA_KEYS } from './xtream-user-data-keys';

/** Internal metadata lives alongside, and is never exported with, playlist positions. */
const resetKey = '__iptvnator_native_playback_resets__';
export const nativePlaybackEpisodeResetKey =
    '__iptvnator_native_playback_episode_resets__';

let lastRequestId: string | undefined;
let checkpointQueueIdle = false;

export function nativePlaybackMayHaveCheckpoint(): boolean {
    return 'TvShell' in globalThis && !checkpointQueueIdle;
}

export function noteNativePlaybackRequest(requestId: string): void {
    lastRequestId = requestId;
    checkpointQueueIdle = false;
}

export function pruneNativePlaybackResets(
    storage: UserDataStorage,
    requestId: string | null
): void {
    // A queued idle notification cannot clear markers for a newer launch.
    if (lastRequestId && requestId !== lastRequestId) return;
    checkpointQueueIdle = true;
    try {
        const key = XTREAM_USER_DATA_KEYS.playbackPositions;
        const raw = storage.getItem(key);
        if (
            !raw ||
            (!raw.includes(resetKey) &&
                !raw.includes(nativePlaybackEpisodeResetKey))
        )
            return;
        const positions = JSON.parse(raw);
        delete positions[resetKey];
        delete positions[nativePlaybackEpisodeResetKey];
        storage.setItem(key, JSON.stringify(positions));
    } catch {
        // Existing progress remains readable when the metadata cleanup cannot run.
    }
}

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
    if (!keys.length || !nativePlaybackMayHaveCheckpoint()) return;
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
