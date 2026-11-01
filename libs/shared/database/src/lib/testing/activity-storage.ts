import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
    SqliteActivityLocalStore,
    SqliteActivityServerStore,
} from '../../activity-sync';
import {
    appendActivityIntent,
    emptyActivityState,
    type ActivityAddress,
    type ActivityOperation,
} from '@iptvnator/shared/interfaces/activity-sync';

const address: ActivityAddress = {
    instanceId: 'nas',
    scope: 'shared',
    sourceId: 'source',
    sourceIncarnation: 'first',
    content: { provider: 'xtream', kind: 'vod', id: '42' },
};
const begin: Extract<ActivityOperation, { kind: 'begin' }> = {
    kind: 'begin',
    operationId: 'begin',
    deviceId: 'desktop',
    expectedRevision: 0,
    sessionId: 'session',
};
const tick: Extract<ActivityOperation, { kind: 'checkpoint' }> = {
    kind: 'checkpoint',
    operationId: 'tick',
    deviceId: 'desktop',
    generation: 1,
    sessionId: 'session',
    sequence: 1,
    resume: { positionSeconds: 25, durationSeconds: 100 },
};
async function main() {
    const directory = mkdtempSync(join(tmpdir(), 'iptvnator-activity-'));
    const path = join(directory, 'activity.db');
    let database = new Database(path);
    try {
        const version = process.argv[2];
        if (version !== 'fresh') {
            database.exec(
                readFileSync(
                    join(__dirname, 'fixtures', `v${version}-schema.sql`),
                    'utf8'
                )
            );
            database
                .prepare(
                    "INSERT INTO playlists (id, name, type) VALUES ('source', 'legacy', 'xtream')"
                )
                .run();
            database
                .prepare(
                    "INSERT INTO categories (id, playlist_id, name, type, xtream_id) VALUES (1, 'source', 'legacy', 'movies', 42)"
                )
                .run();
            database
                .prepare(
                    "INSERT INTO content (id, category_id, title, xtream_id, type) VALUES (1, 1, 'legacy movie', 42, 'movie')"
                )
                .run();
            database
                .prepare(
                    "INSERT INTO favorites (id, content_id, playlist_id) VALUES (1, 1, 'source')"
                )
                .run();
            database
                .prepare(
                    "INSERT INTO recently_viewed (id, content_id, playlist_id) VALUES (1, 1, 'source')"
                )
                .run();
            if (
                database
                    .prepare(
                        "SELECT name FROM sqlite_master WHERE name = 'playback_positions'"
                    )
                    .get()
            ) {
                database
                    .prepare(
                        'INSERT INTO playback_positions (playlist_id, content_xtream_id, content_type, position_seconds, duration_seconds) VALUES (?, ?, ?, ?, ?)'
                    )
                    .run('source', 42, 'vod', 45, 100);
            }
        }
        const tables = database
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
            .all() as { name: string }[];
        const legacy = tables.map(({ name }) => ({
            name,
            rows: database
                .prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"')
                .all(),
        }));
        const authorize = (target: ActivityAddress) => {
            assert.equal(target.instanceId, 'nas');
            assert.equal(target.sourceIncarnation, 'first');
        };
        let local = new SqliteActivityLocalStore(database, 'nas');
        let server = new SqliteActivityServerStore(database, authorize);
        const asynchronousAuthorization = new SqliteActivityServerStore(
            database,
            () => Promise.resolve()
        );
        assert.throws(
            () => asynchronousAuthorization.apply(address, begin),
            /must be synchronous/
        );
        const pending = {
            address,
            consentGeneration: 'consent-1',
            operation: begin,
            deliveryLease: { owner: 'synthetic-origin', expiresAt: Date.now() + 15_000 },
        };
        await local.mutate(address, (current) =>
            appendActivityIntent(current, emptyActivityState(), pending)
        );
        assert.equal((await local.read(address))?.pending.length, 1);
        await assert.rejects(
            local.mutate(address, () => {
                throw new Error('write failed');
            })
        );
        await assert.rejects(
            local.mutate(address, (current) =>
                appendActivityIntent(current, current!.state, pending)
            )
        );
        assert.equal((await local.read(address))?.pending.length, 1);
        await assert.rejects(local.read({ ...address, instanceId: 'other' }));
        assert.deepEqual(await local.pending(), [pending]);
        const first = server.apply(address, begin);
        assert.equal(first.status, 'applied');
        assert.deepEqual(
            server.apply(address, {
                sessionId: 'session',
                expectedRevision: 0,
                deviceId: 'desktop',
                operationId: 'begin',
                kind: 'begin',
            }),
            first
        );
        server.apply(address, tick);
        const reset: ActivityOperation = {
            kind: 'reset',
            operationId: 'reset',
            deviceId: 'phone',
            expectedRevision: 2,
        };
        server.apply(address, reset);
        const cleared = server.read(address);
        assert.equal(cleared.resume, null);
        assert.equal(cleared.watched, false);
        assert.equal(cleared.revision, 3);
        assert.deepEqual(server.apply(address, begin), first);
        assert.deepEqual(server.read(address), cleared);
        const stale = server.apply(address, {
            ...tick,
            operationId: 'late',
            sequence: 2,
        });
        assert.equal(stale.status, 'conflict');
        assert.deepEqual(
            server.apply(address, {
                ...tick,
                operationId: 'late',
                sequence: 2,
            }),
            stale
        );
        assert.throws(
            () => server.apply(address, { ...begin, sessionId: 'changed' }),
            /reused/
        );
        assert.throws(
            () => server.apply({ ...address, sourceId: 'other' }, begin),
            /reused/
        );
        assert.throws(() =>
            server.apply({ ...address, sourceIncarnation: 'recreated' }, tick)
        );

        // Receipt failure must roll back the state mutation too, even though its
        // statement already ran. The same operation can be retried after recovery.
        database.exec(`CREATE TRIGGER fail_activity_receipt BEFORE INSERT ON activity_server_receipts
        BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;`);
        const nextBegin = {
            ...begin,
            operationId: 'next',
            expectedRevision: 3,
        };
        assert.throws(() => server.apply(address, nextBegin));
        assert.deepEqual(server.read(address), cleared);
        database.exec('DROP TRIGGER fail_activity_receipt');
        assert.equal(server.apply(address, nextBegin).status, 'applied');

        database.close();
        database = new Database(path);
        local = new SqliteActivityLocalStore(database, 'nas');
        server = new SqliteActivityServerStore(database, authorize);
        assert.equal(server.read(address).revision, 4);
        assert.deepEqual(server.apply(address, begin), first);
        assert.deepEqual((await local.read(address))?.pending, [pending]);
        await local.mutate(address, (current) => {
            assert(current);
            return { ...current, pending: [] };
        });
        assert.deepEqual(await local.pending(), []);
        assert.deepEqual(
            (await local.read(address))?.state,
            emptyActivityState()
        );
        for (const { name, rows } of legacy) {
            assert.deepEqual(
                database
                    .prepare('SELECT * FROM "' + name.replace(/"/g, '""') + '"')
                    .all(),
                rows
            );
        }
        assert.deepEqual(database.pragma('integrity_check'), [
            { integrity_check: 'ok' },
        ]);
        process.stdout.write('activity storage verified');
    } finally {
        database.close();
        rmSync(directory, { recursive: true, force: true });
    }
}
void main();
