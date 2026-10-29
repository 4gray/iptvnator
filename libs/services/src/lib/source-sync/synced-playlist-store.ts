import {
    type Playlist,
    type SourceDefinition,
    type SourceServerRequest,
    type SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    applySourceDefinition,
    sameSource,
    sourceFromPlaylist,
} from '@iptvnator/shared/interfaces/source-definition';
import {
    PlaylistWriteConflict,
    type PlaylistDocumentStore,
} from '../playlist-storage-backend';
import { retainSourceProjection } from './retain-source-projection';
import {
    snapshotSourceRow,
    assertSourceRowUnchanged,
    stripSourceRowSnapshot,
    preserveUnchangedDeviceFields,
} from './source-row-snapshot';

export type SourceRequest = (
    request: SourceServerRequest
) => Promise<SourceServerResponse>;

/** A definition crosses the network; local activity never does. */
export class SyncedPlaylistStore implements PlaylistDocumentStore {
    private tail = Promise.resolve();
    ready = false;
    collectionRevision?: string;
    readonly pendingSources = new Set<string>();
    constructor(
        readonly local: PlaylistDocumentStore,
        private readonly request: SourceRequest,
        private readonly materialize: (
            source: SourceDefinition,
            current?: Playlist
        ) => Promise<Playlist>,
        private readonly instanceId = 'local',
        private readonly pruneSource?: (
            id: string,
            revision: string | undefined
        ) => Promise<boolean>
    ) {}

    exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.tail.then(() => {
            const locks = globalThis.navigator?.locks;
            return locks
                ? locks.request(
                      `iptvnator:source-sync:${this.instanceId}`,
                      operation
                  )
                : operation();
        });
        this.tail = next.then(
            () => undefined,
            () => undefined
        );
        return next;
    }

    /** Called inside exclusive(), including the inventory refresh. */
    async project(
        source: SourceDefinition,
        revision: string
    ): Promise<Playlist> {
        const current = await this.local.dbGetAppPlaylist(source.id);
        const next = await this.materialize(source, current ?? undefined);
        next.sourceSyncBase = source;
        next.sourceSyncRevision = revision;
        const merge = (latest: Playlist | null) => {
            // Another tab may have projected or deleted this source while its
            // URL was downloading. Activity-only writes still merge below.
            if (
                !!latest !== !!current ||
                latest?.sourceSyncRevision !== current?.sourceSyncRevision ||
                latest?.sourceSyncPending !== current?.sourceSyncPending
            ) {
                if (
                    latest?.sourceSyncRevision === revision &&
                    !latest.sourceSyncPending
                )
                    return latest;
                throw new PlaylistWriteConflict(source.id);
            }
            return latest ? retainSourceProjection(next, latest) : next;
        };
        const projected = this.local.dbMutateAppPlaylist
            ? await this.local.dbMutateAppPlaylist(source.id, merge)
            : merge(await this.local.dbGetAppPlaylist(source.id));
        if (!this.local.dbMutateAppPlaylist)
            await this.local.dbUpsertAppPlaylist(projected);
        if (projected.sourceSyncPending) this.pendingSources.add(source.id);
        else this.pendingSources.delete(source.id);
        return projected;
    }

    dbGetAppPlaylists = async () => {
        if (!this.ready) throw new Error('SOURCE_SYNC.OFFLINE');
        return this.local.dbGetAppPlaylists();
    };
    dbGetAppPlaylistMetas = async () => {
        if (!this.ready) throw new Error('SOURCE_SYNC.OFFLINE');
        if (this.local.dbGetAppPlaylistMetas)
            return this.local.dbGetAppPlaylistMetas();
        return (await this.local.dbGetAppPlaylists()).map((row) => {
            const meta = { ...row };
            delete meta.playlist;
            delete meta.items;
            delete meta.header;
            delete meta.sourceRawM3u;
            delete meta.sourceSyncBase;
            return meta;
        });
    };
    dbGetAppPlaylist = async (id: string) => {
        const row = await this.local.dbGetAppPlaylist(id);
        return row ? snapshotSourceRow(row) : null;
    };
    dbGetAppState = (key: string) => this.local.dbGetAppState(key);
    dbSetAppState = (key: string, value: string) =>
        this.local.dbSetAppState(key, value);

    dbUpsertAppPlaylist = (playlist: Playlist) =>
        this.exclusive(async () => {
            const current = await this.local.dbGetAppPlaylist(playlist._id);
            if (!current && playlist.sourceSyncBase)
                throw new Error('SOURCE_SYNC.CONFLICT');
            const source = sourceFromPlaylist(playlist);
            const baseline = playlist.sourceSyncBase ?? current?.sourceSyncBase;
            let accepted = baseline;
            let revision = current?.sourceSyncRevision;
            if (!baseline || !sameSource(source, baseline)) {
                const response = await this.request({
                    operation: baseline ? 'update' : 'create',
                    id: playlist._id,
                    source,
                    revision: playlist.sourceSyncRevision ?? revision,
                });
                accepted = response.body as SourceDefinition;
                revision = response.etag;
                if (accepted.id !== playlist._id) {
                    const canonical = await this.project(accepted, revision!);
                    const merge = (latest: Playlist | null) => ({
                        ...(latest ?? canonical),
                        favorites: mergeActivity(
                            latest?.favorites ?? canonical.favorites,
                            playlist.favorites
                        ),
                        recentlyViewed: mergeActivity(
                            latest?.recentlyViewed ?? canonical.recentlyViewed,
                            playlist.recentlyViewed
                        ),
                    });
                    const merged = this.local.dbMutateAppPlaylist
                        ? await this.local.dbMutateAppPlaylist(
                              accepted.id,
                              merge
                          )
                        : merge(await this.local.dbGetAppPlaylist(accepted.id));
                    if (!this.local.dbMutateAppPlaylist)
                        await this.local.dbUpsertAppPlaylist(merged);
                    return { success: true, playlist: merged };
                }
            }
            if (!accepted || !revision) throw new Error('SOURCE_SYNC.OFFLINE');
            const metadataOnly =
                !!baseline &&
                sameSource({ ...baseline, title: accepted.title }, accepted);
            let next = stripSourceRowSnapshot(
                baseline && !metadataOnly
                    ? await this.materialize(
                          accepted,
                          applySourceDefinition(baseline, playlist)
                      )
                    : applySourceDefinition(accepted, playlist)
            );
            next.sourceSyncBase = accepted;
            next.sourceSyncRevision = revision;
            // A local mutation based on an older snapshot cannot revert a remote edit.
            const merge = (latest: Playlist | null): Playlist => {
                if (!latest && playlist.sourceSyncBase)
                    throw new Error('SOURCE_SYNC.CONFLICT');
                if (baseline && sameSource(source, baseline))
                    assertSourceRowUnchanged(latest, playlist);
                else
                    next = preserveUnchangedDeviceFields(
                        latest,
                        playlist,
                        next,
                        metadataOnly
                    );
                return latest?.sourceSyncBase &&
                    baseline &&
                    sameSource(source, baseline) &&
                    (!sameSource(latest.sourceSyncBase, baseline) ||
                        latest.sourceSyncPending !== playlist.sourceSyncPending)
                    ? retainSourceProjection(latest, next)
                    : next;
            };
            if (this.local.dbMutateAppPlaylist)
                next = await this.local.dbMutateAppPlaylist(
                    playlist._id,
                    merge
                );
            else {
                next = merge(await this.local.dbGetAppPlaylist(playlist._id));
                await this.local.dbUpsertAppPlaylist(next);
            }
            if (next.sourceSyncPending) this.pendingSources.add(playlist._id);
            else this.pendingSources.delete(playlist._id);
            return { success: true, playlist: next };
        });

    dbUpsertAppPlaylists = async (playlists: Playlist[]) => {
        for (const playlist of playlists)
            await this.dbUpsertAppPlaylist(playlist);
        return { success: true, count: playlists.length };
    };
    dbDeletePlaylist = (id: string) =>
        this.exclusive(async () => {
            const current = await this.local.dbGetAppPlaylist(id);
            await this.request({
                operation: 'delete',
                id,
                revision: current?.sourceSyncRevision,
            });
            if (await this.pruneObserved(id, current?.sourceSyncRevision))
                this.pendingSources.delete(id);
            return { success: true };
        });
    dbDeleteAllPlaylists = () =>
        this.exclusive(async () => {
            const observed = await (this.local.dbGetAppPlaylistMetas?.() ??
                this.local.dbGetAppPlaylists());
            await this.request({
                operation: 'clear',
                revision: this.collectionRevision,
            });
            for (const row of observed)
                if (await this.pruneObserved(row._id, row.sourceSyncRevision))
                    this.pendingSources.delete(row._id);
            return { success: true };
        });

    private async pruneObserved(id: string, revision: string | undefined) {
        if (this.pruneSource) return this.pruneSource(id, revision);
        if (this.local.dbPruneAppPlaylist)
            return this.local.dbPruneAppPlaylist(id, revision, () => undefined);
        // Native stores have a single exclusive owner; browser stores prune
        // inside their IndexedDB transaction through the callback above.
        const current = await this.local.dbGetAppPlaylist(id);
        if (!current || current.sourceSyncRevision !== revision) return false;
        await this.local.dbDeletePlaylist(id);
        return true;
    }
}

function mergeActivity<T>(current: T[] = [], incoming: T[] = []): T[] {
    return [
        ...new Map(
            [...current, ...incoming].map((item) => [
                JSON.stringify(item),
                item,
            ])
        ).values(),
    ];
}
