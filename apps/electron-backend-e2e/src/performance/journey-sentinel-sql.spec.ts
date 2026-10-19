import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { ElectronApplication } from '@playwright/test';

import { JOURNEY_RENDERER_GATE_KEY } from '../journeys/journey-renderer-gate-client';
import { JOURNEY_PERFORMANCE_COUNTERS_CHANNEL } from './journey-main-counters';
import { JOURNEY_RENDERER_API_TRACE_CHANNEL } from './journey-main-ipc-capture';
import {
    installJourneySentinelSqlSampler,
    readJourneySentinelSql,
} from './journey-sentinel-sql';

/** A main process with the gate's handler tap and a running SQL total. */
function createFakeMain(): {
    app: ElectronApplication;
    send(method: string, args: unknown[], phase?: string): void;
    sql: { total: number };
    dispose(): void;
} {
    const ipcMain = new EventEmitter();
    const sql = { total: 0 };
    const target = globalThis as unknown as Record<string, unknown>;
    target[JOURNEY_RENDERER_GATE_KEY] = {
        invokeHandler: async (channel: string) => {
            assert.equal(channel, JOURNEY_PERFORMANCE_COUNTERS_CHANNEL);
            // Read synchronously, as the real handler does.
            const snapshot = {
                counters: { 'main.sqlStatements': sql.total },
            };
            return snapshot;
        },
    };
    const app = {
        evaluate: async (
            fn: (electron: unknown, arg: unknown) => unknown,
            arg: unknown
        ) => fn({ ipcMain }, arg),
    } as unknown as ElectronApplication;
    return {
        app,
        dispose: () => {
            delete target[JOURNEY_RENDERER_GATE_KEY];
        },
        send: (method, args, phase = 'start') => {
            ipcMain.emit(
                JOURNEY_RENDERER_API_TRACE_CHANNEL,
                { sender: { id: 1 } },
                { args, method, phase }
            );
        },
        sql,
    };
}

test('samples the SQL total when each marker first arrives, and only then', async () => {
    const fake = createFakeMain();
    const stateKey = `__journeySentinelSqlTest${Math.random()}`;
    try {
        await installJourneySentinelSqlSampler(fake.app, {
            markers: { firstCard: 'marker-a', rails: 'marker-b' },
            sentinelMethod: 'cancelSourceProbe',
            stateKey,
        });
        fake.sql.total = 10;
        fake.send('dbGetAppState', ['key']);
        fake.send('cancelSourceProbe', ['unrelated']);
        fake.send('cancelSourceProbe', ['marker-a'], 'success');
        await assert.rejects(
            readJourneySentinelSql(fake.app, stateKey, 60),
            /not-sampled: firstCard, rails/
        );
        fake.send('cancelSourceProbe', ['marker-a']);
        fake.sql.total = 25;
        fake.send('cancelSourceProbe', ['marker-a']);
        await assert.rejects(
            readJourneySentinelSql(fake.app, stateKey, 60),
            /not-sampled: rails/
        );
        fake.send('cancelSourceProbe', ['marker-b']);
        const samples = await readJourneySentinelSql(fake.app, stateKey, 1_000);
        assert.equal(samples['firstCard']?.sqlStatements, 10);
        assert.equal(samples['rails']?.sqlStatements, 25);
        assert.ok(
            (samples['rails']?.epochMs ?? 0) >=
                (samples['firstCard']?.epochMs ?? 0)
        );
        await assert.rejects(
            installJourneySentinelSqlSampler(fake.app, {
                markers: {},
                sentinelMethod: 'cancelSourceProbe',
                stateKey,
            }),
            /already-installed/
        );
    } finally {
        fake.dispose();
        delete (globalThis as unknown as Record<string, unknown>)[stateKey];
    }
});

test('refuses to install without the gate tap and to read an absent state', async () => {
    const fake = createFakeMain();
    fake.dispose();
    await assert.rejects(
        installJourneySentinelSqlSampler(fake.app, {
            markers: { a: 'a' },
            sentinelMethod: 'cancelSourceProbe',
            stateKey: '__journeySentinelSqlMissingGate',
        }),
        /gate-missing/
    );
    await assert.rejects(
        readJourneySentinelSql(fake.app, '__journeySentinelSqlNever', 10),
        /missing/
    );
});
