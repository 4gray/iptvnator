import { Injectable, signal } from '@angular/core';

export const PLAYLIST_RECENT_HISTORY_STORAGE_KEY =
    'playlist-switcher:recent:v1';
/** The switcher's "Recent" group shows this many. */
export const PLAYLIST_RECENT_HISTORY_SIZE = 3;

function readIds(): string[] {
    try {
        const parsed: unknown = JSON.parse(
            localStorage.getItem(PLAYLIST_RECENT_HISTORY_STORAGE_KEY) ?? '[]'
        );
        return Array.isArray(parsed)
            ? parsed
                  .filter((id): id is string => typeof id === 'string' && !!id)
                  .slice(0, PLAYLIST_RECENT_HISTORY_SIZE)
            : [];
    } catch {
        return [];
    }
}

/**
 * The playlists opened most recently, newest first, kept across restarts.
 * IDs of deleted playlists stay until pushed out; readers skip the ones that
 * no longer exist.
 */
@Injectable({ providedIn: 'root' })
export class PlaylistRecentHistoryService {
    private readonly state = signal<readonly string[]>(readIds());
    readonly ids = this.state.asReadonly();

    record(playlistId: string): void {
        if (!playlistId || this.state()[0] === playlistId) {
            return;
        }
        const next = [
            playlistId,
            ...this.state().filter((id) => id !== playlistId),
        ].slice(0, PLAYLIST_RECENT_HISTORY_SIZE);
        this.state.set(next);
        try {
            localStorage.setItem(
                PLAYLIST_RECENT_HISTORY_STORAGE_KEY,
                JSON.stringify(next)
            );
        } catch {
            // The list still works for this session.
        }
    }
}
