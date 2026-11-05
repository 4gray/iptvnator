import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
    SqliteHistoryLocalStore,
    SqliteHistoryServerStore,
} from '../../history-sync';
import {
    emptyHistoryRecord,
    visibleHistory,
    type HistoryScope,
    type HistoryOperation,
} from '@iptvnator/shared/interfaces/history-sync';
const scope: HistoryScope = {
    instanceId: 'nas',
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream',
};
const reference = {
    provider: 'xtream' as const,
    kind: 'movie' as const,
    id: '42',
};
const operation = (
    kind: HistoryOperation['kind'],
    id: string,
    baseRevision = 0
): HistoryOperation => ({
    kind,
    operationId: id,
    deviceId: 'desktop',
    baseRevision,
    viewedAt: 100,
    ...(kind === 'clear' ? {} : { reference }),
});
async function main() {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-history-storage-'));
    const file = join(directory, 'history.db');
    let db = new Database(file);
    try {
        const version = process.argv[2];
        if (version !== 'fresh') {
            db.exec(
                readFileSync(
                    join(__dirname, 'fixtures', `v${version}-schema.sql`),
                    'utf8'
                )
            );
            db.exec(
                "INSERT INTO playlists (id,name,type) VALUES ('source','Synthetic source','xtream'); INSERT INTO categories (id,playlist_id,name,type,xtream_id) VALUES (1,'source','Synthetic category','movies',42); INSERT INTO content (id,category_id,title,xtream_id,type) VALUES (1,1,'Synthetic item',42,'movie'); INSERT INTO favorites (id,content_id,playlist_id) VALUES (1,1,'source'); INSERT INTO recently_viewed (id,content_id,playlist_id) VALUES (1,1,'source');"
            );
        }
        const tables = db
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            .all() as { name: string }[];
        const originals = tables.map(({ name }) => ({
            name,
            rows: db
                .prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"')
                .all(),
        }));
        const authorize = (s: HistoryScope) => {
            assert.equal(s.instanceId, 'nas');
            assert.equal(s.sourceIncarnation, 'first');
        };
        let server = new SqliteHistoryServerStore(db, authorize);
        let local = new SqliteHistoryLocalStore(db, 'nas');
        const add = operation('touch', 'watch');
        const first = server.apply(scope, add);
        assert.equal(first.applied, true);
        assert.deepEqual(server.apply(scope, add), first);
        assert.throws(
            () => server.apply(scope, { ...add, kind: 'remove' }),
            /reused/
        );
        const remove = server.apply(scope, operation('remove', 'remove', 1));
        assert.equal(remove.state.revision, 2);
        assert.equal(
            server.apply(scope, { ...add, operationId: 'old-offline' }).applied,
            false
        );
        assert.equal(visibleHistory(server.read(scope)).length, 0);
        // Same-device intentions can follow their accepted predecessor, without opening a stale foreign watch.
        const rewatch = server.apply(scope, {
            ...operation('touch', 'new-watch'),
            after: 'remove',
        });
        assert.equal(rewatch.applied, true);
        assert.equal(visibleHistory(rewatch.state).length, 1);
        const clear = server.apply(scope, operation('clear', 'clear', 3));
        assert.equal(clear.state.cleared, 4);
        assert.equal(
            server.apply(scope, {
                ...operation('touch', 'old-other-device'),
                deviceId: 'other',
            }).applied,
            false
        );
        assert.equal(
            server.apply(scope, {
                ...operation('touch', 'chained-stale'),
                deviceId: 'other',
                after: 'old-other-device',
            }).applied,
            false
        );
        assert.equal(
            server.apply(scope, {
                ...operation('touch', 'after-clear'),
                after: 'clear',
            }).applied,
            true
        );
        assert.throws(() =>
            server.apply(
                { ...scope, sourceIncarnation: 'second' },
                operation('clear', 'bad-source')
            )
        );
        const failing = new SqliteHistoryServerStore(db, () => {
            throw new Error('synthetic refusal');
        });
        assert.throws(() =>
            failing.apply(scope, operation('clear', 'unauthorized'))
        );
        assert.equal(
            (
                db
                    .prepare(
                        'SELECT count(*) AS n FROM history_server_receipts WHERE receipt_key LIKE ?'
                    )
                    .get('%unauthorized%') as { n: number }
            ).n,
            0
        );
        const asyncAuth = new SqliteHistoryServerStore(db, (() =>
            Promise.resolve()) as never);
        assert.throws(() => asyncAuth.read(scope), /synchronous/);
        await local.mutate(scope, () => ({
            ...emptyHistoryRecord(),
            pending: [{ operation: add, consent: 'first' }],
        }));
        const saved = await local.read(scope);
        await assert.rejects(() =>
            local.mutate(scope, (record) => {
                record!.pending = [];
                throw new Error('synthetic rollback');
            })
        );
        assert.deepEqual(await local.read(scope), saved);
        await assert.rejects(() =>
            local.read({ ...scope, instanceId: 'another' })
        );
        // Server state and its receipt must roll back together if receipt persistence fails.
        db.exec(
            "CREATE TRIGGER history_receipt_failure BEFORE INSERT ON history_server_receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END"
        );
        const before = server.read(scope);
        assert.throws(() =>
            server.apply(scope, operation('clear', 'rollback', before.revision))
        );
        assert.deepEqual(server.read(scope), before);
        db.exec('DROP TRIGGER history_receipt_failure');
        db.close();
        db = new Database(file);
        server = new SqliteHistoryServerStore(db, authorize);
        local = new SqliteHistoryLocalStore(db, 'nas');
        assert.deepEqual(server.read(scope), before);
        assert.deepEqual(await local.read(scope), saved);
        assert.equal(
            server.apply(scope, {
                ...operation('touch', 'old-other-device'),
                deviceId: 'other',
            }).applied,
            false
        );
        for (const original of originals)
            assert.deepEqual(
                db
                    .prepare(
                        'SELECT * FROM "' +
                            original.name.replace(/"/g, '""') +
                            '"'
                    )
                    .all(),
                original.rows
            );
        process.stdout.write('history storage verified');
    } finally {
        db.close();
        rmSync(directory, { recursive: true, force: true });
    }
}
void main().catch((error) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
});
