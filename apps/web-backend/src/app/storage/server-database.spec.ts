import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { IPTVNATOR_DATA_DIR_ENV } from '@iptvnator/shared/database';
import { openServerDatabase } from './server-database';
import { ServerPlaylistRepository } from './server-playlist-repository';
import { m3uDocument } from './server-storage.spec-helpers';

describe('openServerDatabase', () => {
    let dataDir: string;
    let previous: string | undefined;

    beforeEach(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-server-db-'));
        previous = process.env[IPTVNATOR_DATA_DIR_ENV];
        process.env[IPTVNATOR_DATA_DIR_ENV] = dataDir;
    });

    afterEach(() => {
        if (previous === undefined) {
            delete process.env[IPTVNATOR_DATA_DIR_ENV];
        } else {
            process.env[IPTVNATOR_DATA_DIR_ENV] = previous;
        }
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('keeps the instance id across restarts', async () => {
        const first = await openServerDatabase();
        const instanceId = first.instanceId;
        first.close();

        const second = await openServerDatabase();
        expect(second.instanceId).toBe(instanceId);
        second.close();
    });

    it('still opens when the stored instance id is empty', async () => {
        const first = await openServerDatabase();
        new ServerPlaylistRepository(first.db).setAppState(
            'server:instance-id',
            ''
        );
        first.close();

        const second = await openServerDatabase();
        expect(second.instanceId).toMatch(/^[0-9a-f-]{36}$/);
        second.close();
    });

    it('runs several writes in one transaction', async () => {
        const database = await openServerDatabase();
        const playlists = new ServerPlaylistRepository(database.db);

        expect(() =>
            database.transaction(() => {
                playlists.setAppState('a', '1');
                throw new Error('fail after the first write');
            })
        ).toThrow('fail after the first write');
        expect(playlists.getAppState('a')).toBeNull();
        database.close();
    });

    it('adds metadata for playlists written without it', async () => {
        const first = await openServerDatabase();
        new ServerPlaylistRepository(first.db).upsert(
            { ...m3uDocument('p1'), filename: 'family.m3u' },
            { keepPayload: false }
        );
        new ServerPlaylistRepository(first.db).upsert(m3uDocument('p2'), {
            keepPayload: false,
        });
        // As in a database the desktop app wrote: rows, no server copy.
        first.db.run(sql`DELETE FROM server_playlist_meta`);
        first.db.run(
            sql`UPDATE playlists SET payload = 'not json' WHERE id = 'p2'`
        );
        first.close();

        const second = await openServerDatabase();
        const metas = new ServerPlaylistRepository(second.db).listMetas();
        expect(metas).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ _id: 'p1', filename: 'family.m3u' }),
                expect.objectContaining({ _id: 'p2', title: 'Family' }),
            ])
        );
        expect(metas[0]['playlist']).toBeUndefined();
        second.close();
    });
});
