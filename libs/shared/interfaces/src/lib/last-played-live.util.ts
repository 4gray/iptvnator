/**
 * Last successfully played live channel. Stored only on this device and never
 * written into playlist files, diagnostics or remote services.
 */
export interface LastPlayedLive {
    sourceType: 'm3u' | 'xtream' | 'stalker';
    playlistId: string;
    itemId: string;
}

const LAST_LIVE_STORAGE_KEY = 'iptvnator-last-played-live-v1';
const STARTUP_LIVE_SESSION_KEY = 'iptvnator-startup-live-v1';

function validated(value: unknown): LastPlayedLive | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Partial<LastPlayedLive>;
    if ((row.sourceType !== 'm3u' && row.sourceType !== 'xtream' &&
         row.sourceType !== 'stalker') ||
        typeof row.playlistId !== 'string' || !row.playlistId.trim() ||
        typeof row.itemId !== 'string' || !row.itemId.trim()) return null;
    return { sourceType: row.sourceType, playlistId: row.playlistId, itemId: row.itemId };
}

export function rememberLastPlayedLive(value: LastPlayedLive): void {
    const verified = validated(value);
    if (!verified) return;
    try { localStorage.setItem(LAST_LIVE_STORAGE_KEY, JSON.stringify(verified)); }
    catch { /* Storage is optional; playback never depends on it. */ }
}

export function readLastPlayedLive(): LastPlayedLive | null {
    try { return validated(JSON.parse(localStorage.getItem(LAST_LIVE_STORAGE_KEY) ?? 'null')); }
    catch { return null; }
}

/** One-shot handoff created only after the startup choice is validated. */
export function prepareStartupLastLive(value: LastPlayedLive): void {
    try { sessionStorage.setItem(STARTUP_LIVE_SESSION_KEY, JSON.stringify(value)); }
    catch { /* Ignore a browser with disabled session storage. */ }
}

export function consumeStartupLastLive(): LastPlayedLive | null {
    try {
        const value = sessionStorage.getItem(STARTUP_LIVE_SESSION_KEY);
        sessionStorage.removeItem(STARTUP_LIVE_SESSION_KEY);
        return validated(value ? JSON.parse(value) : null);
    } catch { return null; }
}
