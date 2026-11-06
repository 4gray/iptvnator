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
    historyScopeKey,
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
        const orderedScope = {
            ...scope,
            instanceId: 'synthetic-order',
            sourceId: 'source-a',
        };
        const secondScope = { ...orderedScope, sourceId: 'source-b' };
        const realNow = Date.now;
        try {
            Date.now = () => 1000;
            const allowed = (s: HistoryScope) => {
                assert.equal(s.instanceId, 'synthetic-order');
            };
            const ordered = new SqliteHistoryServerStore(db, allowed);
            const watch = (id: string, item: string, baseRevision = 0) => ({
                ...operation('touch', id, baseRevision),
                reference: { ...reference, id: item },
            });
            const a = ordered.apply(orderedScope, watch('synthetic-a1', '101'));
            const b = ordered.apply(secondScope, watch('synthetic-b2', '102'));
            const a3 = ordered.apply(
                orderedScope,
                watch('synthetic-a3', '103', 1)
            );
            const global = [...a3.state.items, ...b.state.items].sort(
                (a, b) => b.viewedAt - a.viewedAt
            );
            assert.deepEqual(
                global.map((item) =>
                    item.reference.provider === 'xtream'
                        ? item.reference.id
                        : ''
                ),
                ['103', '102', '101']
            );
            assert.equal(a.state.items[0].viewedAt, 1000);
            assert.equal(b.state.items[0].viewedAt, 1001);
            assert.deepEqual(
                ordered.apply(secondScope, watch('synthetic-b2', '102')),
                b
            );
            const otherDb = new Database(file);
            try {
                const other = new SqliteHistoryServerStore(otherDb, allowed);
                assert.equal(
                    other.apply(
                        { ...orderedScope, sourceId: 'source-c' },
                        watch('synthetic-c4', '104')
                    ).state.items[0].viewedAt,
                    1003
                );
            } finally {
                otherDb.close();
            }
            Date.now = () => 900;
            const a5 = ordered.apply(
                orderedScope,
                watch('synthetic-a5', '105', 2)
            );
            assert.equal(
                a5.state.items.find(
                    (item) =>
                        item.reference.provider === 'xtream' &&
                        item.reference.id === '105'
                )!.viewedAt,
                1004
            );
            // An existing server can predate the instance clock and contain future source timestamps.
            db.prepare(
                'DELETE FROM history_server_clocks WHERE instance_id = ?'
            ).run('synthetic-order');
            db.prepare(
                "UPDATE history_server_states SET value = json_set(value, '$.items[0].viewedAt', 9000) WHERE scope_key = ?"
            ).run(historyScopeKey(orderedScope));
            const b6 = ordered.apply(
                secondScope,
                watch('synthetic-b6', '106', 1)
            );
            assert.equal(
                b6.state.items.find(
                    (item) =>
                        item.reference.provider === 'xtream' &&
                        item.reference.id === '106'
                )!.viewedAt,
                9001
            );
        } finally {
            Date.now = realNow;
        }
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
        const barriers = { ...scope, sourceId: 'independent-items' };
        const otherReference = { ...reference, id: '43' };
        server.apply(barriers, {
            ...operation('remove', 'barrier-b'),
            reference: otherReference,
        });
        server.apply(barriers, operation('touch', 'unrelated-a'));
        assert.equal(
            server.apply(barriers, {
                ...operation('touch', 'stale-b'),
                reference: otherReference,
                after: 'unrelated-a',
            }).applied,
            false
        );
        server.apply(barriers, operation('remove', 'unrelated-remove-a'));
        assert.equal(
            server.apply(barriers, {
                ...operation('touch', 'stale-b-after-remove-a'),
                reference: otherReference,
                after: 'unrelated-remove-a',
            }).applied,
            false
        );
        assert.equal(
            server.apply(barriers, {
                ...operation('touch', 'intentional-b'),
                reference: otherReference,
                after: 'barrier-b',
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
        const clocks = db
            .prepare('SELECT * FROM history_server_clocks ORDER BY instance_id')
            .all();
        assert.throws(() =>
            server.apply(scope, operation('clear', 'rollback', before.revision))
        );
        assert.deepEqual(server.read(scope), before);
        assert.deepEqual(
            db
                .prepare(
                    'SELECT * FROM history_server_clocks ORDER BY instance_id'
                )
                .all(),
            clocks
        );
        db.exec('DROP TRIGGER history_receipt_failure');
        db.close();
        db = new Database(file);
        server = new SqliteHistoryServerStore(db, authorize);
        local = new SqliteHistoryLocalStore(db, 'nas');
        assert.deepEqual(server.read(scope), before);
        assert.deepEqual(await local.read(scope), saved);
        try {
            Date.now = () => 900;
            const reopened = new SqliteHistoryServerStore(db, () => undefined);
            const next = reopened.apply(
                { ...orderedScope, sourceId: 'source-d' },
                operation('touch', 'synthetic-after-reopen')
            );
            assert.equal(next.state.items[0].viewedAt, 9002);
        } finally {
            Date.now = realNow;
        }
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
