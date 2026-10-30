import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPTVNATOR_DATA_DIR_ENV } from '@iptvnator/shared/database';
import { openServerStorage, type ServerStorage } from './server-storage';

/** Real SQLite in a throwaway data directory, closed and removed afterwards. */
export async function withTempStorage<T>(
    run: (storage: ServerStorage) => Promise<T> | T
): Promise<T> {
    const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-server-storage-'));
    const previous = process.env[IPTVNATOR_DATA_DIR_ENV];
    process.env[IPTVNATOR_DATA_DIR_ENV] = dataDir;
    const storage = await openServerStorage();

    try {
        return await run(storage);
    } finally {
        storage.database.close();
        if (previous === undefined) {
            delete process.env[IPTVNATOR_DATA_DIR_ENV];
        } else {
            process.env[IPTVNATOR_DATA_DIR_ENV] = previous;
        }
        rmSync(dataDir, { recursive: true, force: true });
    }
}

export const m3uDocument = (id: string, title = 'Family') => ({
    _id: id,
    title,
    url: `https://example.test/${id}.m3u`,
    count: 1,
    importDate: '2026-10-01T00:00:00.000Z',
    lastUsage: '2026-10-01T00:00:00.000Z',
    favorites: [],
    recentlyViewed: [],
    autoRefresh: false,
    playlist: {
        header: { raw: '#EXTM3U' },
        items: [
            { id: 'a', url: 'https://example.test/a', raw: '#EXTINF:-1,A' },
        ],
    },
});
