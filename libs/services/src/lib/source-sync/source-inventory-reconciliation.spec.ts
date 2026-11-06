import type {
    Playlist,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import { prepareSourceInventory } from './source-inventory-reconciliation';
import type { SyncedPlaylistStore } from './synced-playlist-store';

describe('source inventory revalidation', () => {
    it('captures immutable versions before revalidating an earlier list response', async () => {
        const row = { _id: 'newer', sourceSyncRevision: '"2"' } as Playlist;
        const entries = [{ source: { id: 'newer' }, revision: '"3"' }];
        const request = jest.fn(async () => {
            row.sourceSyncRevision = '"3"';
            return {
                status: 200,
                etag: '"3"',
                body: { entries },
            } as SourceServerResponse;
        });
        const store = {
            local: { dbGetAppPlaylistMetas: async () => [row] },
        } as unknown as SyncedPlaylistStore;
        const result = await prepareSourceInventory(
            store,
            {
                status: 200,
                etag: '"1"',
                body: { entries: [] },
            },
            request
        );
        expect(request).toHaveBeenCalledWith({
            operation: 'list',
            revision: '"1"',
        });
        expect(result.observed.get('newer')).toBe('"2"');
        expect(result.entries).toBe(entries);
        expect(result.revision).toBe('"3"');
    });
});
