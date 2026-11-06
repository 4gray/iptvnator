import type {
    SourceDefinition,
    SourceInventory,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import type {
    SyncedPlaylistStore,
    SourceRequest,
} from './synced-playlist-store';

/** Capture before the authoritative inventory read, only after a changed poll. */
export async function prepareSourceInventory(
    store: SyncedPlaylistStore,
    response: SourceServerResponse,
    request: SourceRequest
) {
    const local = store.local;
    const observed = new Map(
        (
            await (local.dbGetAppPlaylistMetas?.() ?? local.dbGetAppPlaylists())
        ).map((row) => [row._id, row.sourceSyncRevision] as const)
    );
    // A sibling may have written between the first response and this snapshot.
    // Revalidate only changed polls; ordinary 304 polls never read large rows.
    const confirmed = await request({
        operation: 'list',
        revision: response.etag,
    });
    const current = confirmed.status === 304 ? response : confirmed;
    return {
        observed,
        entries: (current.body as SourceInventory).entries,
        revision: current.etag,
    };
}

export async function reconcileSourceInventory(
    store: SyncedPlaylistStore,
    entries: SourceInventory['entries'],
    observed: ReadonlyMap<string, string | undefined>,
    request: SourceRequest,
    prune: (id: string, revision: string | undefined) => Promise<boolean>
) {
    let changed = false;
    for (const entry of entries) {
        const current = await store.local.dbGetAppPlaylist(entry.source.id);
        if (
            current?.sourceSyncRevision === entry.revision &&
            !current.sourceSyncPending
        )
            continue;
        let source = entry.source;
        if (source.kind === 'm3u-text')
            source = (await request({ operation: 'get', id: source.id }))
                .body as SourceDefinition;
        await store.project(source, entry.revision);
        changed = true;
    }
    const ids = new Set(entries.map((entry) => entry.source.id));
    for (const [id, revision] of observed) {
        if (ids.has(id)) continue;
        if (!(await prune(id, revision))) continue;
        store.pendingSources.delete(id);
        changed = true;
    }
    return { ids, changed };
}
