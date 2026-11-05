import Database from 'better-sqlite3';
import { webcrypto } from 'node:crypto';
import { SqliteFavoriteLocalStore } from '@iptvnator/shared/database/favorites-sync';
import { ElectronFavoriteLocalStore } from './electron-favorites-local';
import { FavoritesSyncClient } from './favorites-sync-client';
import {
    emptyFavoriteState,
    type FavoriteAddress,
    type FavoriteLocalRequest,
} from '@iptvnator/shared/interfaces/favorites-sync';
const source = {
    sourceId: 'source',
    sourceIncarnation: 'first',
    provider: 'xtream' as const,
};
const address: FavoriteAddress = {
    instanceId: 'nas',
    scope: 'shared',
    sourceId: source.sourceId,
    sourceIncarnation: source.sourceIncarnation,
    content: { provider: 'xtream', kind: 'movie', id: '42' },
};
beforeAll(() =>
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: webcrypto,
    })
);
describe('native favorite CAS over real persisted rows', () => {
    it.each([false, true])(
        'preserves a sibling write on a CAS retry (consent revoked: %s)',
        async (revoke) => {
            const db = new Database(':memory:');
            try {
                const sql = new SqliteFavoriteLocalStore(db, 'nas');
                let consent: string | null = 'first-consent';
                let commits = 0;
                const send = async (
                    request: FavoriteLocalRequest
                ): Promise<unknown> => {
                    if (request.operation === 'read')
                        return sql.read(request.address);
                    if (request.operation === 'list')
                        return sql.entries(request.sourceId);
                    if (request.operation === 'pending') return sql.pending();
                    if (++commits === 1) {
                        await sql.mutate(address, () => ({
                            base: emptyFavoriteState(),
                            state: { revision: 0, member: false },
                            local: { revision: 0, member: false },
                            pending: [],
                        }));
                        if (revoke) consent = null;
                    }
                    try {
                        const value = await sql.mutate(
                            request.address,
                            (current) => {
                                if (
                                    (current === null
                                        ? null
                                        : JSON.stringify(current)) !==
                                    request.expected
                                )
                                    throw new Error('conflict');
                                return request.value;
                            }
                        );
                        return { value };
                    } catch {
                        return { conflict: true };
                    }
                };
                const native = new ElectronFavoriteLocalStore('nas', send);
                const client = new FavoritesSyncClient(native, {
                    instanceId: 'nas',
                    deviceId: 'device',
                    contexts: [source],
                    consent: () => consent,
                    request: async () => {
                        throw new Error('offline');
                    },
                    remember: () => undefined,
                    changed: () => undefined,
                });
                if (revoke) {
                    await expect(
                        client.set('source', address.content, true)
                    ).rejects.toThrow();
                    expect(await sql.read(address)).toMatchObject({
                        state: { member: false },
                        local: { member: false },
                        pending: [],
                    });
                } else {
                    await client.set('source', address.content, true, {
                        title: 'Synthetic item',
                    });
                    expect(commits).toBe(2);
                    expect((await sql.read(address))?.pending).toHaveLength(1);
                    expect((await sql.read(address))?.state).toMatchObject({
                        member: true,
                    });
                }
                expect(db.prepare('PRAGMA integrity_check').get()).toEqual({
                    integrity_check: 'ok',
                });
            } finally {
                db.close();
            }
        }
    );
});
