import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    USER_DATA_STORAGE,
    type UserDataStorage,
} from '@iptvnator/services';
import { createSourceProfileUserDataStorage } from '@iptvnator/services/source-sync/profile-user-data';
import { FAVORITES_PLAYLIST_BRIDGE } from '@iptvnator/services/favorites-events';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { StalkerPortalItem } from '@iptvnator/shared/interfaces';
import { UnifiedFavoritesDataService } from './unified-favorites-data.service';
import { StalkerCollectionMetadataService } from '@iptvnator/portal/stalker/data-access';

const orderKey = 'global-favorites-channel-order-v1';
const typedUid = (item: StalkerPortalItem) =>
    `stalker::synthetic-source::${favoriteReferenceKey(stalkerFavoriteReference(item)!)}`;
function fixture(
    favorites: StalkerPortalItem[],
    order: string[] | undefined,
    native = false,
    storage: UserDataStorage = localStorage,
    syncActive = true
) {
    const document = {
        _id: 'synthetic-source',
        title: 'Synthetic source',
        macAddress: 'synthetic-mac',
        favorites,
    };
    let encoded = JSON.stringify(order ?? []);
    if (order) storage.setItem(orderKey, encoded);
    const original = window.electron;
    Object.defineProperty(window, 'electron', {
        configurable: true,
        writable: true,
        value: {
            dbGetAppState: async () => encoded,
            dbSetAppState: async (_key: string, value: string) => {
                encoded = value;
            },
        },
    });
    TestBed.configureTestingModule({
        providers: [
            UnifiedFavoritesDataService,
            {
                provide: StalkerCollectionMetadataService,
                useValue: { project: (value: unknown) => value },
            },
            { provide: USER_DATA_STORAGE, useValue: storage },
            {
                provide: FAVORITES_PLAYLIST_BRIDGE,
                useValue: {
                    active: () => syncActive,
                    project: async (value: unknown) => value,
                },
            },
            {
                provide: RuntimeCapabilitiesService,
                useValue: {
                    supportsAppStateStorage: native,
                    supportsPortalActivityStorage: false,
                },
            },
            {
                provide: Store,
                useValue: {
                    select: () =>
                        of([
                            document,
                            {
                                _id: 'synthetic-xtream',
                                title: 'Synthetic portal',
                                serverUrl: 'https://synthetic.invalid',
                            },
                        ]),
                },
            },
            {
                provide: PlaylistsService,
                useValue: {
                    getPlaylistById: () => of(document),
                    preparePortalFavoriteActions: async () => undefined,
                },
            },
            { provide: DatabaseService, useValue: {} },
            {
                provide: TranslateService,
                useValue: { instant: (key: string) => key },
            },
            {
                provide: XTREAM_DATA_SOURCE,
                useValue: {
                    getFavorites: async () => [
                        {
                            xtream_id: 42,
                            type: 'movie',
                            title: 'Synthetic movie',
                        },
                    ],
                },
            },
        ],
    });
    return {
        service: TestBed.inject(UnifiedFavoritesDataService),
        readOrder: () => (native ? encoded : storage.getItem(orderKey)),
        restore: () => {
            window.electron = original;
            storage.removeItem(orderKey);
        },
    };
}
describe('legacy global Stalker favorite order', () => {
    it('keeps browser ordering isolated across server profiles and reopening a profile without adopting the standalone order', async () => {
        const favorites: StalkerPortalItem[] = [
            { id: '1', favoriteContentType: 'vod' },
            { id: '2', favoriteContentType: 'itv' },
        ];
        const legacy = JSON.stringify([
            typedUid(favorites[1]),
            typedUid(favorites[0]),
        ]);
        localStorage.setItem(orderKey, legacy);
        const storageA = createSourceProfileUserDataStorage(
            'iptvnator-server:synthetic-a'
        );
        const storageB = createSourceProfileUserDataStorage(
            'iptvnator-server:synthetic-b'
        );
        const first = fixture(favorites, undefined, false, storageA);
        let second: ReturnType<typeof fixture> | undefined;
        let reopened: ReturnType<typeof fixture> | undefined;
        try {
            const rows = await first.service.getFavorites('all');
            const orderA = [...rows].reverse();
            await first.service.reorder(orderA, { scope: 'all' });
            TestBed.resetTestingModule();
            second = fixture(favorites, undefined, false, storageB);
            await second.service.reorder(rows, { scope: 'all' });
            expect(
                (await first.service.getFavorites('all')).map((row) => row.uid)
            ).toEqual(orderA.map((row) => row.uid));
            expect(
                (await second.service.getFavorites('all')).map((row) => row.uid)
            ).toEqual(rows.map((row) => row.uid));
            expect(localStorage.getItem(orderKey)).toBe(legacy);
            TestBed.resetTestingModule();
            reopened = fixture(favorites, undefined, false, storageA);
            expect(
                (await reopened.service.getFavorites('all')).map(
                    (row) => row.uid
                )
            ).toEqual(orderA.map((row) => row.uid));
        } finally {
            reopened?.restore();
            second?.restore();
            first.restore();
            localStorage.removeItem(orderKey);
        }
    });
    it.each([false, true])(
        'preserves historical placement among providers (native=%s)',
        async (native) => {
            const favorites: StalkerPortalItem[] = [
                { id: '1', favoriteContentType: 'vod' },
                { id: '2', favoriteContentType: 'itv' },
            ];
            const saved = [
                'stalker::synthetic-source::2',
                'xtream::synthetic-xtream::movie:42',
                'stalker::synthetic-source::1',
            ];
            const f = fixture(favorites, saved, native);
            try {
                expect(
                    (await f.service.getFavorites('all')).map(
                        (item) => item.uid
                    )
                ).toEqual([
                    typedUid(favorites[1]),
                    saved[1],
                    typedUid(favorites[0]),
                ]);
                expect(f.readOrder()).toBe(JSON.stringify(saved));
            } finally {
                f.restore();
            }
        }
    );
    it('uses exact typed keys and does not guess an ambiguous historical provider ID', async () => {
        const favorites: StalkerPortalItem[] = [
            { id: '42', favoriteContentType: 'vod' },
            { id: '42', favoriteContentType: 'itv' },
        ];
        const saved = [
            typedUid(favorites[0]),
            'stalker::synthetic-source::42',
            'xtream::synthetic-xtream::movie:42',
        ];
        const f = fixture(favorites, saved);
        try {
            expect(
                (await f.service.getFavorites('all')).map((item) => item.uid)
            ).toEqual([saved[0], saved[2], typedUid(favorites[1])]);
        } finally {
            f.restore();
        }
    });
    it.each([false, true])(
        'preserves the standalone placement of a legacy same-ID group (native=%s)',
        async (native) => {
            const favorites: StalkerPortalItem[] = [
                { id: '42', category_id: '11', favoriteContentType: 'radio' },
                { id: '9', category_id: 'itv' },
                { id: '42', category_id: '12', favoriteContentType: 'itv' },
                { id: '42', category_id: 'vod' },
            ];
            const saved = [
                'stalker::synthetic-source::42',
                'xtream::synthetic-xtream::movie:42',
                'stalker::synthetic-source::9',
            ];
            const f = fixture(favorites, saved, native, localStorage, false);
            try {
                const rows = await f.service.getFavorites('all');
                expect(rows.map(({ uid }) => uid)).toEqual([
                    typedUid(favorites[0]),
                    typedUid(favorites[2]),
                    typedUid(favorites[3]),
                    saved[1],
                    saved[2],
                ]);
                expect(
                    rows.slice(0, 3).map(({ contentType }) => contentType)
                ).toEqual(['live', 'live', 'movie']);
                expect(rows[0].radio).toBe('true');
                expect(f.readOrder()).toBe(JSON.stringify(saved));

                const reordered = [...rows].reverse();
                await f.service.reorder(reordered, { scope: 'all' });
                expect(
                    (await f.service.getFavorites('all')).map(({ uid }) => uid)
                ).toEqual(reordered.map(({ uid }) => uid));

                // A surviving row keeps its saved placement when its UID
                // returns to the historical unambiguous form.
                favorites.splice(3, 1);
                favorites.splice(2, 1);
                expect(
                    (await f.service.getFavorites('all')).map(({ uid }) => uid)
                ).toEqual([saved[2], saved[1], saved[0]]);
            } finally {
                f.restore();
            }
        }
    );
});
