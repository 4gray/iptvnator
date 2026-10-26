import { sourceAuthorization } from './source-authorization';
import {
    type Playlist,
    type SourceServerConnection,
} from '@iptvnator/shared/interfaces';
import {
    applySourceDefinition,
    sourceFromPlaylist,
} from '@iptvnator/shared/interfaces/source-definition';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import { assertSourceInstance } from './source-connection';
import { requestSourceServer } from './source-api';
import { wasLegacySourceClient } from './legacy-source-client';

/** One-time upgrade of old playlist activity; new devices never read this API. */
export async function migrateLegacyPlaylistActivity(
    local: PlaylistDocumentStore,
    connection: SourceServerConnection,
    sourceIds: ReadonlySet<string>
): Promise<void> {
    const marker = 'source-sync-legacy-playlist-activity';
    if (
        (await local.dbGetAppState(marker)) === '1' ||
        !wasLegacySourceClient(connection.instanceId)
    )
        return;
    const url = `${connection.apiUrl}/v1/playlists`;
    const response = await fetch(url, {
        headers: sourceAuthorization(url),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
        throw new Error(
            response.status === 401
                ? 'SOURCE_SYNC.LOCKED'
                : 'SOURCE_SYNC.REQUEST_FAILED'
        );
    const rows: unknown = await response.json();
    // A replaced NAS database must not seed this profile from another instance.
    const probe = await requestSourceServer({ operation: 'instance' });
    assertSourceInstance(probe.body);
    if (probe.body.instanceId !== connection.instanceId)
        throw new Error('SOURCE_SYNC.INSTANCE_CHANGED');
    if (!Array.isArray(rows)) throw new Error('SOURCE_SYNC.REQUEST_FAILED');
    for (const value of rows) {
        const row = value as Partial<Playlist> | null;
        if (!row || typeof row._id !== 'string' || !sourceIds.has(row._id))
            continue;
        if (
            (row.favorites !== undefined && !Array.isArray(row.favorites)) ||
            (row.recentlyViewed !== undefined &&
                !Array.isArray(row.recentlyViewed))
        )
            throw new Error('SOURCE_SYNC.REQUEST_FAILED');
        const seed: Playlist = {
            ...applySourceDefinition(sourceFromPlaylist(row as Playlist)),
            _id: row._id,
            title: row.title ?? '',
            count: 0,
            autoRefresh: !!row.autoRefresh,
            importDate: row.importDate ?? new Date().toISOString(),
            lastUsage: row.lastUsage ?? '',
            favorites: row.favorites ?? [],
            recentlyViewed: row.recentlyViewed ?? [],
            hiddenGroupTitles: row.hiddenGroupTitles,
            position: row.position,
            detectedEpgUrls: row.detectedEpgUrls,
            epgUrls: row.epgUrls,
            manualEpgUrls: row.manualEpgUrls,
            disabledEpgUrls: row.disabledEpgUrls,
            ...(!row.macAddress && !row.serverUrl && row.playlist
                ? {
                      playlist: row.playlist,
                      count: row.playlist.items?.length ?? row.count ?? 0,
                  }
                : {}),
        };
        if (local.dbMutateAppPlaylist)
            await local.dbMutateAppPlaylist(
                row._id,
                (current) => current ?? seed
            );
        else if (!(await local.dbGetAppPlaylist(row._id)))
            await local.dbUpsertAppPlaylist(seed);
    }
    await local.dbSetAppState(marker, '1');
}
