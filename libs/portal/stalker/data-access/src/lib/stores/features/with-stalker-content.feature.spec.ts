import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { DataService } from 'services';
import { PlaylistMeta, StalkerPortalActions } from 'shared-interfaces';
import { StalkerSessionService } from '../../stalker-session.service';
import { withStalkerContent } from './with-stalker-content.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-04-14T00:00:00.000Z',
    portalUrl: 'http://demo.example/stalker_portal/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

const TestContentStore = signalStore(
    withState({
        currentPlaylist: undefined as PlaylistMeta | undefined,
        selectedContentType: 'vod' as 'vod' | 'series' | 'itv',
        selectedCategoryId: undefined as string | null | undefined,
        searchPhrase: '',
        page: 0,
        limit: 14,
    }),
    withMethods((store) => ({
        setCurrentPlaylist(playlist: PlaylistMeta | undefined) {
            patchState(store, { currentPlaylist: playlist });
        },
        setSelectedContentType(type: 'vod' | 'series' | 'itv') {
            patchState(store, { selectedContentType: type });
        },
        setSelectedCategory(id: string | null | undefined) {
            patchState(store, { selectedCategoryId: id });
        },
    })),
    withStalkerContent()
);

async function flushResources(): Promise<void> {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
    TestBed.flushEffects();
    await Promise.resolve();
}

async function waitForCondition(
    predicate: () => boolean,
    attempts = 20
): Promise<void> {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) {
            return;
        }

        await flushResources();
    }

    throw new Error('Timed out waiting for resource activity');
}

describe('withStalkerContent failure states', () => {
    let store: InstanceType<typeof TestContentStore>;
    let dataService: {
        sendIpcEvent: jest.Mock<Promise<unknown>, unknown[]>;
    };

    beforeEach(() => {
        dataService = {
            sendIpcEvent: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                TestContentStore,
                { provide: DataService, useValue: dataService },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        makeAuthenticatedRequest: jest.fn(),
                    },
                },
                {
                    provide: TranslateService,
                    useValue: {
                        instant: jest.fn((key: string) => key),
                    },
                },
            ],
        });

        store = TestBed.inject(TestContentStore);
    });

    it('normalizes category failures into empty arrays and explicit error state', async () => {
        dataService.sendIpcEvent.mockRejectedValue(
            new Error('get_genres failed')
        );

        store.setSelectedContentType('itv');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isCategoryResourceLoading();

        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length > 0
        );
        await flushResources();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                url: PLAYLIST.portalUrl,
                macAddress: PLAYLIST.macAddress,
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetGenres,
                    type: 'itv',
                }),
            })
        );
        expect(store.getCategoryResource()).toEqual([]);
        expect(store.itvCategories()).toEqual([]);
        expect(store.isCategoryResourceFailed()).toBeInstanceOf(Error);
        expect((store.isCategoryResourceFailed() as Error).message).toBe(
            'get_genres failed'
        );
    });

    it('derives the selected category from the normalized category collections', () => {
        store.setSelectedContentType('series');
        store.setCategories('series', [
            {
                category_id: '7',
                category_name: 'Drama',
            },
        ]);
        store.setSelectedCategory('7');

        expect(store.getSelectedCategory()).toEqual({
            category_id: '7',
            category_name: 'Drama',
        });
    });

    it('normalizes content failures into empty collections instead of undefined state', async () => {
        dataService.sendIpcEvent.mockRejectedValue(
            new Error('get_ordered_list failed')
        );

        store.setSelectedContentType('itv');
        store.setCategories('itv', [
            {
                category_id: '5',
                category_name: 'News',
            },
        ]);
        store.setSelectedCategory('5');
        store.setCurrentPlaylist(PLAYLIST);
        void store.isPaginatedContentLoading();

        await waitForCondition(
            () => dataService.sendIpcEvent.mock.calls.length > 0
        );
        await flushResources();

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                params: expect.objectContaining({
                    action: StalkerPortalActions.GetOrderedList,
                    type: 'itv',
                    category: '5',
                    genre: '5',
                }),
            })
        );
        expect(store.getPaginatedContent()).toEqual([]);
        expect(store.itvChannels()).toEqual([]);
        expect(store.hasMoreChannels()).toBe(false);
        expect(store.isPaginatedContentFailed()).toBeInstanceOf(Error);
        expect((store.isPaginatedContentFailed() as Error).message).toBe(
            'get_ordered_list failed'
        );
    });
});
