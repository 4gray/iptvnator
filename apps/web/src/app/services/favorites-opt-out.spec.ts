import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import { favoritesProfileUsed } from './favorites-consent';
import { signal, type EnvironmentInjector } from '@angular/core';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { FavoritesSyncRuntime } from './favorites-sync-runtime';
import { invokeFavorites } from './favorites-sync.providers';
import { invokeHistory } from './history-sync.providers';

describe('new sources after favorites opt-out', () => {
    beforeEach(async () => {
        localStorage.clear();
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'http://synthetic.invalid/api',
                instanceId: 'synthetic-nas',
            })
        );
        await prepareSourceConnection();
        localStorage.setItem(
            'iptvnator-server:synthetic-nas:favorites-consent-v1',
            JSON.stringify({
                enabled: false,
                generation: 'previous-consent',
                deviceId: 'synthetic-device',
            })
        );
        expect(favoritesProfileUsed()).toBe(true);
    });
    afterEach(async () => {
        localStorage.clear();
        await prepareSourceConnection();
    });
    const runtime = () => {
        const value = Object.create(
            FavoritesSyncRuntime.prototype
        ) as FavoritesSyncRuntime;
        const request = jest.fn();
        const contexts = new Map();
        Object.assign(value, {
            error: signal(false),
            ensureClient: () => ({ contexts, options: { request } }),
        });
        return { value, request, contexts };
    };
    it('allows provider references only for a context this disabled profile already owns', async () => {
        const { value, contexts } = runtime();
        const raw = {} as IXtreamDataSource;
        expect(
            await value.invoke(raw, 'supportsPortableFavorites', [
                'synthetic-new-source',
            ])
        ).toBe(false);
        contexts.set('synthetic-known-source', { sourceIncarnation: 'first' });
        expect(
            await value.invoke(raw, 'supportsPortableFavorites', [
                'synthetic-known-source',
            ])
        ).toBe(true);
    });
    it('returns playlist mutations to ordinary local persistence without requesting context', async () => {
        const { value, request } = runtime();
        expect(
            await value.mutate(
                {
                    _id: 'synthetic-new-source',
                    favorites: [],
                } as unknown as Playlist,
                () => ['synthetic-local']
            )
        ).toBeNull();
        expect(request).not.toHaveBeenCalled();
    });
    it.each([
        ['favorites', 'addFavorite', invokeFavorites],
        ['history', 'addRecentItem', invokeHistory],
        ['history', 'clearRecentItems', invokeHistory],
    ] as const)(
        'cancels a %s mutation if consent changes while initializing %s',
        async (collection, method, invoke) => {
            const runtime = { invoke: jest.fn().mockResolvedValue(undefined) };
            const raw = {} as IXtreamDataSource;
            const args =
                method === 'clearRecentItems'
                    ? ['synthetic-source']
                    : [42, 'synthetic-source'];
            const stable = {
                get: () => runtime,
            } as unknown as EnvironmentInjector;
            await expect(
                invoke(stable, raw, method, args)
            ).resolves.toBeUndefined();
            expect(runtime.invoke).toHaveBeenCalledTimes(1);

            const changed = {
                get: () => {
                    localStorage.setItem(
                        `iptvnator-server:synthetic-nas:${collection}-consent-v1`,
                        '{"enabled":true,"generation":"new-consent"}'
                    );
                    return runtime;
                },
            } as unknown as EnvironmentInjector;
            await expect(invoke(changed, raw, method, args)).rejects.toThrow(
                /action ownership changed/
            );
            expect(runtime.invoke).toHaveBeenCalledTimes(1);
        }
    );

    it('keeps Xtream reads and writes on the local data source without consent', async () => {
        const { value, request } = runtime();
        const getFavorites = jest.fn(async () => []);
        const addFavorite = jest.fn(async () => undefined);
        const raw = {
            getFavorites,
            addFavorite,
        } as unknown as IXtreamDataSource;
        const target = { id: 42, type: 'movie' };
        expect(
            await value.invoke(raw, 'getFavorites', ['synthetic-new-source'])
        ).toEqual([]);
        await value.invoke(raw, 'addFavorite', [
            target,
            'synthetic-new-source',
        ]);
        expect(addFavorite).toHaveBeenCalledWith(
            target,
            'synthetic-new-source'
        );
        expect(request).not.toHaveBeenCalled();
    });
});
