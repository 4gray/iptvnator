import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPTVNATOR_DATA_DIR_ENV } from '@iptvnator/shared/database';
import { SqliteFavoriteServerStore } from '@iptvnator/shared/database/favorites-sync';
import { ensureActivitySchema } from '@iptvnator/shared/database/activity-sync';
import { ensureHistorySchema } from '@iptvnator/shared/database/history-sync';
import type { FavoriteAddress } from '@iptvnator/shared/interfaces/favorites-sync';
import type { PersonalScope } from '@iptvnator/shared/interfaces/profiles';
import { openServerStorage, type ServerStorage } from './server-storage';

const source = { sourceId: 'source-1', sourceIncarnation: 'incarnation-1' };
const favoriteSource = { ...source, provider: 'xtream' as const };

function favorite(instanceId: string, scope: PersonalScope): FavoriteAddress {
    return {
        instanceId,
        scope,
        ...source,
        content: { provider: 'xtream', kind: 'movie', id: '101' },
    } as FavoriteAddress;
}

function rows(storage: ServerStorage, table: string): number {
    return (
        storage.database.sqlite
            .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
            .get() as { n: number }
    ).n;
}

/** Rows shaped like each store writes them, one per scope. */
function seedRawState(storage: ServerStorage, scope: PersonalScope): void {
    const db = storage.database.sqlite;
    const instance = storage.database.instanceId;
    ensureActivitySchema(db);
    ensureHistorySchema(db);
    const address = JSON.stringify({
        instanceId: instance,
        scope,
        ...source,
        content: { provider: 'xtream', kind: 'vod', id: '7' },
    });
    const key = `activity|${scope}`;
    db.prepare(
        'INSERT INTO activity_server_states VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
        key,
        address,
        instance,
        source.sourceId,
        source.sourceIncarnation,
        '{}'
    );
    db.prepare('INSERT INTO activity_server_receipts VALUES (?, ?, ?)').run(
        JSON.stringify([instance, scope, 'device', `op-${scope}`]),
        '[]',
        '{}'
    );
    const historyKey = JSON.stringify([
        instance,
        source.sourceId,
        source.sourceIncarnation,
        'xtream',
        ...(scope === 'shared' ? [] : [scope]),
    ]);
    db.prepare('INSERT INTO history_server_states VALUES (?, ?)').run(
        historyKey,
        '{}'
    );
    db.prepare(
        'INSERT INTO history_server_receipts VALUES (?, ?, ?, ?, ?)'
    ).run(`receipt|${scope}`, historyKey, '[]', 1, 1);
}

async function withDataDir<T>(
    run: (open: () => Promise<ServerStorage>) => Promise<T>
): Promise<T> {
    const dataDir = mkdtempSync(join(tmpdir(), 'iptvnator-profile-state-'));
    const previous = process.env[IPTVNATOR_DATA_DIR_ENV];
    process.env[IPTVNATOR_DATA_DIR_ENV] = dataDir;
    try {
        return await run(() => openServerStorage());
    } finally {
        if (previous === undefined) delete process.env[IPTVNATOR_DATA_DIR_ENV];
        else process.env[IPTVNATOR_DATA_DIR_ENV] = previous;
        rmSync(dataDir, { recursive: true, force: true });
    }
}

describe('profile state', () => {
    it('keeps each profile apart and lists the Default profile when no scope is given', () =>
        withDataDir(async (open) => {
            const storage = await open();
            try {
                const kid = storage.profiles.create('Kid', undefined, null);
                const store = new SqliteFavoriteServerStore(
                    storage.database.sqlite,
                    () => undefined
                );
                const instance = storage.database.instanceId;
                const op = (id: string) => ({
                    operationId: id,
                    deviceId: 'device',
                    expectedRevision: 0,
                    member: true,
                });
                expect(
                    store.apply(favorite(instance, 'shared'), op('a')).status
                ).toBe('applied');
                expect(
                    store.apply(favorite(instance, kid.scope), op('b')).status
                ).toBe('applied');

                const shared = store.list(instance, favoriteSource).entries;
                expect(shared.map((e) => e.address.scope)).toEqual(['shared']);
                const kids = store.list(
                    instance,
                    favoriteSource,
                    '',
                    kid.scope
                ).entries;
                expect(kids.map((e) => e.address.scope)).toEqual([kid.scope]);
                expect(store.read(favorite(instance, kid.scope)).member).toBe(
                    true
                );
            } finally {
                storage.database.close();
            }
        }));

    it('deletes a profile with all of its state and nothing of the Default profile', () =>
        withDataDir(async (open) => {
            const storage = await open();
            try {
                const kid = storage.profiles.create('Kid', undefined, null);
                const store = new SqliteFavoriteServerStore(
                    storage.database.sqlite,
                    () => undefined
                );
                const instance = storage.database.instanceId;
                for (const scope of ['shared', kid.scope] as PersonalScope[]) {
                    store.apply(favorite(instance, scope), {
                        operationId: `op-${scope}`,
                        deviceId: 'device',
                        expectedRevision: 0,
                        member: true,
                    });
                    seedRawState(storage, scope);
                }
                const tables = [
                    'favorite_server_states',
                    'favorite_server_receipts',
                    'activity_server_states',
                    'activity_server_receipts',
                    'history_server_states',
                    'history_server_receipts',
                ];
                for (const table of tables)
                    expect(rows(storage, table)).toBe(2);

                expect(storage.profiles.delete(kid.id)).toBe(true);

                for (const table of tables)
                    expect(rows(storage, table)).toBe(1);
                expect(
                    store.list(instance, favoriteSource).entries
                ).toHaveLength(1);
                expect(storage.profiles.hasScope(kid.scope)).toBe(false);
                expect(storage.profiles.list().map((p) => p.id)).toEqual([
                    'default',
                ]);
            } finally {
                storage.database.close();
            }
        }));

    it('opens a database written before profiles existed and keeps its Default state', () =>
        withDataDir(async (open) => {
            const before = await open();
            const instance = before.database.instanceId;
            new SqliteFavoriteServerStore(
                before.database.sqlite,
                () => undefined
            ).apply(favorite(instance, 'shared'), {
                operationId: 'old',
                deviceId: 'device',
                expectedRevision: 0,
                member: true,
            });
            // The profiles table did not exist in earlier releases.
            before.database.sqlite.exec('DROP TABLE server_profiles');
            before.database.close();

            const after = await open();
            try {
                expect(after.database.instanceId).toBe(instance);
                expect(after.profiles.list().map((p) => p.id)).toEqual([
                    'default',
                ]);
                const store = new SqliteFavoriteServerStore(
                    after.database.sqlite,
                    () => undefined
                );
                expect(store.read(favorite(instance, 'shared')).member).toBe(
                    true
                );
                expect(
                    store.list(instance, favoriteSource).entries
                ).toHaveLength(1);
            } finally {
                after.database.close();
            }
        }));
});
