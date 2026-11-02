import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import { favoritesProfileUsed } from './favorites-consent';
import { signal } from '@angular/core';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type { IXtreamDataSource } from '@iptvnator/portal/xtream/data-access';
import { FavoritesSyncRuntime } from './favorites-sync-runtime';

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
