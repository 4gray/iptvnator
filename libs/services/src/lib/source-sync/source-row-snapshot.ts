import type { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistWriteConflict } from '../playlist-storage-backend';
import { resolvePlaylistEpgSourceState } from '@iptvnator/shared/m3u-utils';

import {
    READ_SNAPSHOT,
    type SnapshotPlaylist,
} from './source-row-snapshot-context';
export { stripSourceRowSnapshot } from './source-row-snapshot-context';

function readVersion(row: Playlist | null): string {
    if (!row) return 'null';
    // Payload changes carry a source revision, pending transition or refresh
    // date. Avoid copying a potentially huge parsed/raw M3U for every toggle.
    const metadata = {
        ...row,
        sourceSyncBase: row.sourceSyncBase
            ? { ...row.sourceSyncBase, rawM3u: undefined }
            : undefined,
    };
    delete metadata.playlist;
    delete metadata.sourceRawM3u;
    delete metadata.items;
    delete metadata.header;
    return JSON.stringify(metadata);
}

export function snapshotSourceRow(row: Playlist): Playlist {
    return {
        ...row,
        [READ_SNAPSHOT]: { version: readVersion(row), playlist: row.playlist },
    } as SnapshotPlaylist;
}

export function assertSourceRowUnchanged(
    current: Playlist | null,
    incoming: Playlist
): void {
    const snapshot = (incoming as SnapshotPlaylist)[READ_SNAPSHOT];
    if (snapshot !== undefined && snapshot.version !== readVersion(current))
        throw new PlaylistWriteConflict(incoming._id);
}

/** An awaited source edit must not replace activity it never changed. */
export function preserveUnchangedDeviceFields(
    current: Playlist | null,
    original: Playlist,
    next: Playlist,
    metadataOnly = false
): Playlist {
    const snapshot = (original as SnapshotPlaylist)[READ_SNAPSHOT];
    if (!snapshot || !current) return next;
    const previous = JSON.parse(snapshot.version) as Playlist;
    const result = { ...next };
    if (metadataOnly && original.playlist === snapshot.playlist) {
        for (const key of [
            'playlist',
            'count',
            'updateDate',
            'updateState',
            'detectedEpgUrls',
            'epgUrls',
            'sourceSyncPending',
        ] as const) {
            delete (result as Partial<Playlist>)[key];
            if (current[key] !== undefined)
                Object.assign(result, { [key]: current[key] });
        }
    }
    for (const key of [
        'favorites',
        'recentlyViewed',
        'autoRefresh',
        'autoImportEpg',
        'position',
        'hiddenGroupTitles',
        'manualEpgUrls',
        'disabledEpgUrls',
        'lastUsage',
    ] as const) {
        if (JSON.stringify(previous[key]) !== JSON.stringify(original[key]))
            continue;
        delete (result as Partial<Playlist>)[key];
        if (current[key] !== undefined)
            Object.assign(result, { [key]: current[key] });
    }
    const detected = result.detectedEpgUrls;
    const knownManual = new Set([
        ...(previous.manualEpgUrls ?? []),
        ...(current.manualEpgUrls ?? []),
    ]);
    return Object.assign(
        result,
        resolvePlaylistEpgSourceState({
            autoImportEpg: result.autoImportEpg,
            detectedEpgUrls: detected,
            enabledEpgUrls: result.epgUrls?.filter(
                (url) => detected?.includes(url) || !knownManual.has(url)
            ),
            manualEpgUrls: result.manualEpgUrls,
            disabledEpgUrls: result.disabledEpgUrls,
        })
    );
}
