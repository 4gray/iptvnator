import { InjectionToken } from '@angular/core';
import type {
    Playlist,
    PlaylistRecentlyViewedItem,
    PlaylistRecentIdentity,
} from '@iptvnator/shared/interfaces';
export type HistoryPlaylistAction =
    | { kind: 'touch'; item: PlaylistRecentlyViewedItem }
    | { kind: 'remove'; identities: PlaylistRecentIdentity[] }
    | { kind: 'clear' };
export interface HistoryPlaylistBridge {
    active(): boolean;
    project<T extends Playlist>(playlist: T): Promise<T>;
    mutate(
        playlist: Playlist,
        action: HistoryPlaylistAction
    ): Promise<Playlist | null>;
}
export const HISTORY_PLAYLIST_BRIDGE =
    new InjectionToken<HistoryPlaylistBridge>('History', {
        providedIn: 'root',
        factory: () => ({
            active: () => false,
            project: async (p) => p,
            mutate: async () => null,
        }),
    });

/** A delayed playback confirmation may not record an old source in a replacement profile. */
export function captureHistoryOwner(
    instanceId: string | undefined,
    sourceId: string,
    currentInstance: () => string | undefined
): () => boolean {
    const key = instanceId
        ? `iptvnator-server:${instanceId}:history-source-epoch:${sourceId}`
        : null;
    try {
        const epoch = key ? localStorage.getItem(key) : null;
        return () => {
            try {
                return (
                    currentInstance() === instanceId &&
                    (!key || localStorage.getItem(key) === epoch)
                );
            } catch {
                return false;
            }
        };
    } catch {
        return () => false;
    }
}
