import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { FAVORITES_PLAYLIST_BRIDGE } from '@iptvnator/services/favorites-events';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';

const item = (
    playlistId: string,
    favoriteId: number
): UnifiedCollectionItem => ({
    uid: `xtream::${playlistId}::movie:42`,
    name: 'Synthetic retained favorite',
    sourceType: 'xtream',
    playlistId,
    playlistName: 'Synthetic source',
    contentType: 'movie',
    xtreamId: 42,
    favoriteId,
    catalogStatus: 'missing',
});
describe('source-scoped Xtream favorite storage after opt-out', () => {
    const original = window.electron;
    let remove: jest.Mock;
    let reorder: jest.Mock;
    let portableRemove: jest.Mock;
    let portable: jest.Mock;
    let getFavorites: jest.Mock;
    let select: jest.Mock;
    let capabilities: {
        supportsPortalActivityStorage: boolean;
        supportsXtreamSqliteDataSource: boolean;
    };
    let service: UnifiedFavoritesDataService;
    beforeEach(() => {
        remove = jest.fn(async () => undefined);
        reorder = jest.fn(async () => ({ success: true }));
        portableRemove = jest.fn(async () => undefined);
        portable = jest.fn(async (id: string) => id === 'synthetic-known');
        getFavorites = jest.fn(async () => []);
        select = jest.fn(() => of([]));
        capabilities = {
            supportsPortalActivityStorage: true,
            supportsXtreamSqliteDataSource: true,
        };
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: {
                dbRemoveFavorite: remove,
                dbReorderGlobalFavorites: reorder,
            },
        });
        TestBed.configureTestingModule({
            providers: [
                UnifiedFavoritesDataService,
                {
                    provide: FAVORITES_PLAYLIST_BRIDGE,
                    useValue: { active: () => true },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: capabilities,
                },
                { provide: Store, useValue: { select } },
                { provide: PlaylistsService, useValue: {} },
                { provide: DatabaseService, useValue: {} },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: {
                        supportsPortableFavorites: portable,
                        getFavorites,
                        removeFavorite: portableRemove,
                    },
                },
            ],
        });
        service = TestBed.inject(UnifiedFavoritesDataService);
    });
    afterEach(() => {
        window.electron = original;
        localStorage.clear();
    });
    it.each([
        { native: true, scope: 'all' as const },
        { native: true, scope: 'playlist' as const },
        { native: false, scope: 'all' as const },
        { native: false, scope: 'playlist' as const },
    ])(
        'preserves catalog selection for portable favorites ($scope, native=$native)',
        async ({ native, scope }) => {
            capabilities.supportsXtreamSqliteDataSource = native;
            select.mockReturnValue(
                of([
                    {
                        _id: 'synthetic-known',
                        title: 'Synthetic selected source',
                        serverUrl: 'https://synthetic.test',
                        xtreamContentTypes: ['movie'],
                    },
                ])
            );
            getFavorites.mockResolvedValue(
                ['live', 'movie', 'series'].map((type, index) => ({
                    id: index + 1,
                    xtream_id: index + 11,
                    title: `Synthetic retained item ${index}`,
                    type,
                }))
            );
            const rows = await service.getFavorites(
                scope,
                'synthetic-known',
                'xtream'
            );
            expect(rows).toHaveLength(3);
            expect(rows.map((row) => row.catalogDisabled)).toEqual(
                native ? [true, false, true] : [false, false, false]
            );
            expect(getFavorites).toHaveBeenCalledWith('synthetic-known');
        }
    );
    it.each(['remove', 'clear'] as const)(
        'uses favorite ID for %s on a new source without sync context',
        async (action) => {
            const retained = item('synthetic-new', 77);
            if (action === 'remove') await service.removeFavorite(retained);
            else await service.clearFavorites([retained]);
            expect(remove).toHaveBeenCalledWith(
                { favoriteId: 77 },
                'synthetic-new'
            );
            expect(portableRemove).not.toHaveBeenCalled();
        }
    );
    it('uses each source capability when clearing a mixed collection', async () => {
        await service.clearFavorites([
            item('synthetic-new', 77),
            item('synthetic-known', 78),
        ]);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledWith(
            { favoriteId: 77 },
            'synthetic-new'
        );
        expect(portableRemove).toHaveBeenCalledTimes(1);
        expect(portableRemove).toHaveBeenCalledWith(
            expect.objectContaining({ providerId: 42, type: 'movie' }),
            'synthetic-known'
        );
    });
    it('persists only native source positions when reordering a mixed collection', async () => {
        const rows = [item('synthetic-new', 77), item('synthetic-known', 78)];
        await service.reorder(rows, { scope: 'all' });
        expect(reorder).toHaveBeenCalledWith([
            { favorite_id: 77, playlist_id: 'synthetic-new', position: 0 },
        ]);
        expect(
            JSON.parse(
                localStorage.getItem('global-favorites-channel-order-v1')!
            )
        ).toEqual(rows.map((row) => row.uid));
    });
    it('keeps other sources in place when reordering one portable playlist', async () => {
        const a = {
            ...item('synthetic-known', 1),
            uid: 'xtream::synthetic-known::movie:41',
            xtreamId: 41,
        };
        const b = item('synthetic-known', 2);
        const other = item('synthetic-new', 3);
        const key = 'global-favorites-channel-order-v1';
        localStorage.setItem(key, JSON.stringify([a.uid, other.uid, b.uid]));
        await service.reorder([b, a], {
            scope: 'playlist',
            playlistId: 'synthetic-known',
            portalType: 'xtream',
        });
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual([
            b.uid,
            other.uid,
            a.uid,
        ]);
        expect(reorder).not.toHaveBeenCalled();
    });
});
