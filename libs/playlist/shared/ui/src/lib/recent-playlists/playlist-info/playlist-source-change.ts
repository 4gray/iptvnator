import { PlaylistMeta } from '@iptvnator/shared/interfaces';

/**
 * Whether a save points an M3U playlist at a new URL or file, so it should be
 * fetched again from there (issue #1677). Xtream and Stalker sources have their
 * own connection handling.
 */
export function hasM3uSourceChanged(
    stored: PlaylistMeta,
    saved: PlaylistMeta
): boolean {
    if (stored.serverUrl || stored.portalUrl) return false;
    return (
        (Boolean(stored.url) && saved.url !== stored.url) ||
        (Boolean(stored.filePath) && saved.filePath !== stored.filePath)
    );
}
