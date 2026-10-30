import type { ElectronBridgeResult } from '@iptvnator/shared/interfaces';
import type { PlaylistDocumentStore } from '../playlist-storage-backend';
import type { PlaylistDeleteCleanup } from '../playlist-delete-cleanup.token';
import { sourceProfileStorageKey } from './source-profile-storage';

/** Per-ID markers survive row deletion, app restarts and concurrent browser tabs. */
export class SourceCleanupQueue {
    private readonly removeLocal;
    private readonly clearLocal;

    constructor(
        private readonly local: PlaylistDocumentStore,
        private readonly cleanups: PlaylistDeleteCleanup[],
        private readonly prefix = sourceProfileStorageKey(
            'source-sync-cleanup:'
        )
    ) {
        this.removeLocal = local.dbDeletePlaylist.bind(local);
        this.clearLocal = local.dbDeleteAllPlaylists.bind(local);
    }

    remove = (id: string): Promise<ElectronBridgeResult> =>
        this.guard(async () => {
            this.mark(id);
            return this.finish(id);
        });

    /** Source projections must wait until an earlier ID's cleanup completes. */
    assertWritable(id: string): void {
        if (localStorage.getItem(`${this.prefix}${id}`) !== null)
            throw new Error('SOURCE_SYNC.REQUEST_FAILED');
    }

    prune = (id: string, revision: string | undefined): Promise<boolean> =>
        this.guard(async () => {
            if (this.local.dbPruneAppPlaylist) {
                const removed = await this.local.dbPruneAppPlaylist(
                    id,
                    revision,
                    () => this.mark(id, JSON.stringify([revision ?? null]))
                );
                if (!removed) return false;
            } else {
                // Native writes share the exclusive owner; payload-free metas
                // omit the revision, while browser pruning always checks it atomically.
                const current = await this.local.dbGetAppPlaylist(id);
                if (
                    !current ||
                    (revision !== undefined &&
                        current.sourceSyncRevision !== revision)
                )
                    return false;
                this.mark(id);
            }
            await this.finish(id);
            return true;
        });

    clear = (): Promise<ElectronBridgeResult> =>
        this.guard(async () => {
            const rows = await (this.local.dbGetAppPlaylistMetas?.() ??
                this.local.dbGetAppPlaylists());
            // Persist every marker before SQL/IndexedDB can remove the inventory.
            for (const row of rows) this.mark(row._id);
            const result = await this.clearLocal();
            if (result?.success === false) throw new Error();
            for (const row of rows) await this.finish(row._id);
            return result;
        });

    retry(): Promise<void> {
        try {
            const keys = Array.from(
                { length: localStorage.length },
                (_, index) => localStorage.key(index)
            ).filter((key): key is string => !!key?.startsWith(this.prefix));
            // Idle inventory polls do not acquire or advance the owner database.
            if (!keys.length) return Promise.resolve();
            return this.guard(async () => {
                for (const key of keys)
                    await this.finish(key.slice(this.prefix.length));
            });
        } catch {
            return Promise.reject(new Error('SOURCE_SYNC.REQUEST_FAILED'));
        }
    }

    private mark(id: string, value = '1'): void {
        const key = `${this.prefix}${id}`;
        localStorage.setItem(key, value);
        if (localStorage.getItem(key) !== value) throw new Error();
    }

    private async finish(id: string): Promise<ElectronBridgeResult> {
        const key = `${this.prefix}${id}`;
        const marker = localStorage.getItem(key);
        if (marker === null) return { success: true };
        let result: ElectronBridgeResult = { success: true };
        if (marker !== '1') {
            const revision =
                (JSON.parse(marker) as [string | null])[0] ?? undefined;
            if (await this.local.dbGetAppPlaylist(id)) {
                if (!this.local.dbPruneAppPlaylist) throw new Error();
                const removed = await this.local.dbPruneAppPlaylist(
                    id,
                    revision,
                    () => undefined
                );
                if (!removed) {
                    // A newer row is outside this abandoned deletion's authority.
                    localStorage.removeItem(key);
                    if (localStorage.getItem(key) !== null) throw new Error();
                    return result;
                }
            }
        } else if (await this.local.dbGetAppPlaylist(id))
            result = await this.removeLocal(id);
        if (result?.success === false) throw new Error();
        for (const cleanup of this.cleanups) await cleanup(id);
        localStorage.removeItem(key);
        if (localStorage.getItem(key) !== null) throw new Error();
        return result;
    }

    private async guard<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await (this.local.dbWithSourceCleanup?.(operation) ??
                operation());
        } catch {
            // Keep markers in place and expose a translated recoverable error.
            throw new Error('SOURCE_SYNC.REQUEST_FAILED');
        }
    }
}
