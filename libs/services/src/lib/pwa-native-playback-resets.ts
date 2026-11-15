/** Internal metadata lives alongside, and is never exported with, playlist positions. */
const resetKey = '__iptvnator_native_playback_resets__';

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
