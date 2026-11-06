import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
    SqliteFavoriteLocalStore,
    SqliteFavoriteServerStore,
} from '../../favorites-sync';
import {
    emptyFavoriteState,
    type FavoriteAddress,
} from '@iptvnator/shared/interfaces/favorites-sync';
const address: FavoriteAddress = {
    instanceId: 'nas',
    scope: 'shared',
    sourceId: 'source',
    sourceIncarnation: 'first',
    content: { provider: 'xtream', kind: 'movie', id: '42' },
};
async function main() {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-favorites-sync-'));
    const path = join(directory, 'favorites.db');
    let db = new Database(path);
    try {
        const version = process.argv[2];
        if (version !== 'fresh') {
            db.exec(
                readFileSync(
                    join(__dirname, 'fixtures', `v${version}-schema.sql`),
                    'utf8'
                )
            );
            db.prepare(
                "INSERT INTO playlists (id, name, type) VALUES ('source', 'Synthetic source', 'xtream')"
            ).run();
            db.prepare(
                "INSERT INTO categories (id, playlist_id, name, type, xtream_id) VALUES (1, 'source', 'Synthetic category', 'movies', 42)"
            ).run();
            db.prepare(
                "INSERT INTO content (id, category_id, title, xtream_id, type) VALUES (1, 1, 'Synthetic item', 42, 'movie')"
            ).run();
            db.prepare(
                "INSERT INTO favorites (id, content_id, playlist_id) VALUES (1, 1, 'source')"
            ).run();
            db.prepare(
                "INSERT INTO recently_viewed (id, content_id, playlist_id) VALUES (1, 1, 'source')"
            ).run();
        }
        const tables = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
            .all() as { name: string }[];
        const originals = tables.map(({ name }) => ({
            name,
            rows: db
                .prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"')
                .all(),
        }));
        const authorize = (a: FavoriteAddress) => {
            assert.equal(a.instanceId, 'nas');
            assert.equal(a.sourceIncarnation, 'first');
        };
        let local = new SqliteFavoriteLocalStore(db, 'nas');
        let server = new SqliteFavoriteServerStore(db, authorize);
        const add = {
            operationId: 'add',
            deviceId: 'desktop',
            expectedRevision: 0,
            member: true,
            snapshot: { title: 'Synthetic item' },
        };
        const pending = {
            address,
            consentGeneration: 'consent-1',
            operation: add,
        };
        await local.mutate(address, () => ({
            base: emptyFavoriteState(),
            state: { revision: 1, member: true },
            pending: [pending],
        }));
        await assert.rejects(
            local.mutate(address, (current) => ({
                ...current!,
                pending: [pending, pending],
            }))
        );
        await assert.rejects(
            local.mutate(address, () => {
                throw new Error('synthetic failure');
            })
        );
        await assert.rejects(local.read({ ...address, instanceId: 'other' }));
        assert.equal((await local.pending()).length, 1);
        assert.equal((await local.entries('source')).length, 1);
        const first = server.apply(address, add);
        assert.equal(first.status, 'applied');
        assert.deepEqual(
            server.apply(address, {
                ...add,
                snapshot: { title: 'Synthetic item' },
            }),
            first
        );
        assert.throws(
            () => server.apply(address, { ...add, member: false }),
            /ID reused/
        );
        const removed = server.apply(address, {
            ...add,
            operationId: 'remove',
            member: false,
            expectedRevision: 1,
        });
        assert.equal(removed.state.member, false);
        assert.equal(removed.state.revision, 2);
        assert.deepEqual(server.apply(address, add), first);
        assert.equal(server.read(address).member, false);
        assert.equal(
            server.apply(address, { ...add, operationId: 'stale' }).status,
            'conflict'
        );
        assert.throws(() =>
            server.read({ ...address, sourceIncarnation: 'second' })
        );
        const asyncAuth = new SqliteFavoriteServerStore(db, () =>
            Promise.resolve()
        );
        assert.throws(
            () => asyncAuth.apply(address, add),
            /must be synchronous/
        );
        for (let i = 0; i < 104; i++)
            server.apply(
                {
                    ...address,
                    content: {
                        provider: 'xtream',
                        kind: 'live',
                        id: String(i + 1),
                    },
                },
                { ...add, operationId: 'live-' + i }
            );
        const page = server.list('nas', {
            sourceId: 'source',
            provider: 'xtream',
            sourceIncarnation: 'first',
        });
        assert.equal(page.entries.length, 100);
        assert.ok(page.cursor);
        assert.equal(
            server.list(
                'nas',
                {
                    sourceId: 'source',
                    provider: 'xtream',
                    sourceIncarnation: 'first',
                },
                page.cursor
            ).entries.length,
            5
        );
        db.close();
        db = new Database(path);
        local = new SqliteFavoriteLocalStore(db, 'nas');
        server = new SqliteFavoriteServerStore(db, authorize);
        assert.deepEqual(server.apply(address, add), first);
        assert.equal(server.read(address).revision, 2);
        assert.equal((await local.read(address))?.pending.length, 1);
        for (const { name, rows } of originals)
            assert.deepEqual(
                db
                    .prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"')
                    .all(),
                rows
            );
        assert.deepEqual(db.prepare('PRAGMA integrity_check').get(), {
            integrity_check: 'ok',
        });
        process.stdout.write('favorites storage verified');
    } finally {
        db.close();
        rmSync(directory, { recursive: true, force: true });
    }
}
void main();
