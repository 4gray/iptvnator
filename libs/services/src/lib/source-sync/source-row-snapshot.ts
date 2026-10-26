import type { Playlist } from '@iptvnator/shared/interfaces';
import { PlaylistWriteConflict } from '../playlist-storage-backend';
import { resolvePlaylistEpgSourceState } from '@iptvnator/shared/m3u-utils';

// Enumerable symbols survive object spreads in renderer mutations, but never
// JSON/structured-clone persistence, backups or source-definition requests.
const READ_SNAPSHOT = Symbol('source-row-read-snapshot');
type SnapshotPlaylist = Playlist & {
    [READ_SNAPSHOT]?: { version: string; playlist: Playlist['playlist'] };
};

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

export function stripSourceRowSnapshot(row: Playlist): Playlist {
    const result: SnapshotPlaylist = { ...row };
    delete result[READ_SNAPSHOT];
    return result;
}

export function inheritSourceRowSnapshot(
    current: Playlist | undefined,
    next: Playlist
): Playlist {
    const result = stripSourceRowSnapshot(next) as SnapshotPlaylist;
    const snapshot = (current as SnapshotPlaylist | undefined)?.[READ_SNAPSHOT];
    if (snapshot !== undefined) result[READ_SNAPSHOT] = snapshot;
    return result;
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
    const detected = result.detectedEpgUrls ?? result.epgUrls;
    return Object.assign(
        result,
        resolvePlaylistEpgSourceState({
            detectedEpgUrls: detected,
            enabledEpgUrls: result.epgUrls?.filter((url) =>
                detected?.includes(url)
            ),
            manualEpgUrls: result.manualEpgUrls,
            disabledEpgUrls: result.disabledEpgUrls,
        })
    );
}
