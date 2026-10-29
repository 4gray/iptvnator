import type { Playlist } from '@iptvnator/shared/interfaces';

type RefreshSource = Partial<Pick<Playlist, 'url' | 'filePath' | 'userAgent'>>;

/** Absent fields support legacy partial payloads; captured fields are authoritative. */
export function playlistRefreshMatchesSource(
    current: RefreshSource | undefined,
    refreshed: RefreshSource
): boolean {
    return (
        !current ||
        (['url', 'filePath', 'userAgent'] as const).every(
            (key) =>
                !(key in refreshed) ||
                (current[key]?.trim() ?? '') === (refreshed[key]?.trim() ?? '')
        )
    );
}

/** A download does not own the playlist's connection or user-given name. */
export function retainPlaylistRefreshSource(
    current: Partial<Playlist> | undefined
): Partial<
    Pick<
        Playlist,
        'title' | 'url' | 'filePath' | 'userAgent' | 'referrer' | 'origin'
    >
> {
    return current && (current.url || current.filePath)
        ? {
              title: current.title,
              url: current.url,
              filePath: current.filePath,
              userAgent: current.userAgent,
              referrer: current.referrer,
              origin: current.origin,
          }
        : {};
}
