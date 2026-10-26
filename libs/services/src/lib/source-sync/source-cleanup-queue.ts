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
        return this.guard(async () => {
            const keys = Array.from(
                { length: localStorage.length },
                (_, index) => localStorage.key(index)
            );
            for (const key of keys) {
                if (key?.startsWith(this.prefix))
                    await this.finish(key.slice(this.prefix.length));
            }
        });
    }

    private mark(id: string): void {
        const key = `${this.prefix}${id}`;
        localStorage.setItem(key, '1');
        if (localStorage.getItem(key) !== '1') throw new Error();
    }

    private async finish(id: string): Promise<ElectronBridgeResult> {
        const result = (await this.local.dbGetAppPlaylist(id))
            ? await this.removeLocal(id)
            : { success: true };
        if (result?.success === false) throw new Error();
        for (const cleanup of this.cleanups) await cleanup(id);
        const key = `${this.prefix}${id}`;
        localStorage.removeItem(key);
        if (localStorage.getItem(key) !== null) throw new Error();
        return result;
    }

    private async guard<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch {
            // Keep markers in place and expose a translated recoverable error.
            throw new Error('SOURCE_SYNC.REQUEST_FAILED');
        }
    }
}
