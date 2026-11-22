import { TestBed } from '@angular/core/testing';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { TranslateService } from '@ngx-translate/core';
import { DataService, ParentalLockService } from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerItvCacheService } from '../../stalker-itv-cache.service';
import { StalkerSessionService } from '../../stalker-session.service';
import { StalkerContentType } from '../stalker-store.contracts';
import { withStalkerContent } from './with-stalker-content.feature';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({ warn: jest.fn(), error: jest.fn() }),
}));

const Store = signalStore(
    withState({
        currentPlaylist: undefined as PlaylistMeta | undefined,
        selectedContentType: 'vod' as StalkerContentType,
        selectedCategoryId: null as string | null,
        searchPhrase: '',
        page: 0,
    }),
    withMethods((store) => ({
        setPage(page: number) {
            patchState(store, { page });
        },
        selectCategory(selectedCategoryId: string) {
            patchState(store, { selectedCategoryId, page: 0 });
        },
        selectPlaylist(
            id: string,
            hiddenStalkerCategories?: PlaylistMeta['hiddenStalkerCategories']
        ) {
            patchState(store, {
                currentPlaylist: {
                    _id: id,
                    hiddenStalkerCategories,
                    portalUrl: `http://${id}.example/portal.php`,
                    macAddress: '00:1A:79:00:00:01',
                    isFullStalkerPortal: false,
                } as PlaylistMeta,
            });
        },
        selectType(selectedContentType: StalkerContentType) {
            patchState(store, { selectedContentType });
        },
    })),
    withStalkerContent()
);

function deferred() {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function settle() {
    for (let i = 0; i < 10; i++) {
        TestBed.tick();
        await Promise.resolve();
    }
}

describe('Stalker category ownership', () => {
    let store: InstanceType<typeof Store>;
    let request: jest.Mock;
    let getChannels: jest.Mock;
    beforeEach(() => {
        getChannels = jest.fn(() => null);
        request = jest.fn().mockResolvedValue({ js: [] });
        TestBed.configureTestingModule({
            providers: [
                Store,
                { provide: DataService, useValue: { sendIpcEvent: request } },
                {
                    provide: ParentalLockService,
                    useValue: {
                        active: () => false,
                        lockedStalkerIds: () => [],
                        version: () => 0,
                    },
                },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
                {
                    provide: StalkerSessionService,
                    useValue: {
                        ensureToken: jest
                            .fn()
                            .mockResolvedValue({ token: null }),
                    },
                },
                {
                    provide: StalkerItvCacheService,
                    useValue: {
                        versionFor: () => 0,
                        getChannels,
                        ensureLoaded: jest.fn(),
                        isReady: () => getChannels() !== null,
                        isLoading: () => false,
                        progressOf: () => null,
                        isUnsupported: () => false,
                    },
                },
            ],
        });
        store = TestBed.inject(Store);
        void store.isCategoryResourceLoading();
    });

    const categories = [
        { category_id: '*', category_name: '' },
        { category_id: '01', category_name: 'First genre' },
        { category_id: '02', category_name: 'Second genre' },
    ];

    it.each(['vod', 'series'] as const)(
        'continues past a hidden first %s page using the original provider total',
        async (section) => {
            request
                .mockResolvedValueOnce({
                    js: {
                        data: [{ id: 'one', category_id: '01' }],
                        total_items: 2,
                    },
                })
                .mockResolvedValueOnce({
                    js: {
                        data: [{ id: 'two', category_id: '02' }],
                        total_items: 2,
                    },
                });
            store.selectType(section);
            store.selectPlaylist('a', { [section]: ['01'] });
            store.setCategories(section, categories);
            store.selectCategory('*');
            for (
                let attempt = 0;
                attempt < 10 && !store.getPaginatedContent().length;
                attempt++
            ) {
                await settle();
            }
            expect(store.getPaginatedContent().map((row) => row.id)).toEqual([
                'two',
            ]);
            expect(store.hasMoreContent()).toBe(false);
            expect(request).toHaveBeenCalledTimes(2);
        }
    );

    it('filters cached All channels and their counts while retaining raw genres for recovery', async () => {
        getChannels.mockReturnValue([
            { id: 'one', category_id: '01' },
            { id: 'two', tv_genre_id: '02' },
        ]);
        store.selectType('itv');
        store.selectPlaylist('a', { itv: ['01'], radio: ['02'] });
        store.setCategories('itv', categories);
        store.selectCategory('*');
        await settle();
        expect(
            store.getCategoryResource().map((genre) => genre.category_id)
        ).toEqual(['*', '02']);
        expect(store.itvFullChannelList().map((row) => row.id)).toEqual([
            'two',
        ]);
        expect(store.itvCategoryItemCounts().get(Number.NaN)).toBe(1);
        expect(store.manageItvCategoryCounts()).toEqual(
            new Map([
                ['01', 1],
                ['02', 1],
            ])
        );
        store.selectPlaylist('a', { itv: ['01', '02'] });
        await settle();
        expect(store.itvChannels()).toEqual([]);
        expect(store.getAllCategoriesForSelectedType()).toEqual(categories);
        store.selectPlaylist('a');
        await settle();
        expect(store.itvChannels()).toHaveLength(2);
        expect(request).not.toHaveBeenCalled();
    });

    it('uses the exact provider genre for cache selection and paged fallback', async () => {
        getChannels.mockReturnValue([
            { id: 'cached', tv_genre_id: ' ', category_id: '01' },
        ]);
        store.selectType('itv');
        store.selectPlaylist('a');
        store.setCategories('itv', [
            ...categories,
            { category_id: '1', category_name: 'Another genre' },
        ]);
        store.selectCategory('01');
        await settle();
        expect(store.itvSelectedCategoryFromCache()).toBe(true);
        expect(store.itvChannels().map((row) => row.id)).toEqual(['cached']);
        expect(request).not.toHaveBeenCalled();

        request.mockResolvedValue({
            js: { data: [{ id: 'paged', tv_genre_id: '1' }], total_items: 2 },
        });
        store.selectCategory('1');
        await settle();
        expect(store.itvSelectedCategoryFromCache()).toBe(false);
        expect(store.itvChannels().map((row) => row.id)).toEqual(['paged']);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('allows a saved hidden channel to play until its parental lock is active', async () => {
        const channel = { id: '1', category_id: '01' };
        getChannels.mockReturnValue([channel]);
        store.selectType('itv');
        store.selectPlaylist('a', { itv: ['01'] });
        store.setCategories('itv', categories);
        store.selectCategory('*');
        await settle();
        expect(store.itvFullChannelList()).toEqual([]);
        expect(store.findItvChannelForHandoff('1')).toEqual(channel);
        const lock = TestBed.inject(ParentalLockService);
        jest.spyOn(lock, 'active').mockReturnValue(true);
        jest.spyOn(lock, 'lockedStalkerIds').mockReturnValue(['01']);
        expect(store.findItvChannelForHandoff('1')).toBeNull();
    });

    it('removes an already displayed radio genre during a pending reload and discards its stale page', async () => {
        const first = {
            js: {
                data: [
                    { id: 'station-one', tv_genre_id: ' ', category_id: '01' },
                    { id: 'station-two', tv_genre_id: '02' },
                ],
                total_items: 3,
            },
        };
        const append = deferred();
        const replacement = deferred();
        request
            .mockResolvedValueOnce(first)
            .mockReturnValueOnce(append.promise)
            .mockReturnValue(replacement.promise);
        store.selectType('radio');
        store.selectPlaylist('a');
        store.setCategories('radio', categories);
        store.selectCategory('*');
        await settle();
        expect(store.radioChannels()).toHaveLength(2);
        store.setPage(1);
        await settle();
        expect(request).toHaveBeenCalledTimes(2);
        store.selectPlaylist('a', { radio: ['01'] });
        await settle();
        expect(store.page()).toBe(0);
        expect(store.radioChannels().map((row) => row.id)).toEqual([
            'station-two',
        ]);
        append.resolve(first);
        await settle();
        expect(store.radioChannels().map((row) => row.id)).toEqual([
            'station-two',
        ]);
        replacement.resolve(first);
        await settle();
        expect(store.radioChannels().map((row) => row.id)).toEqual([
            'station-two',
        ]);
    });

    it('sends no request on a reset alone', async () => {
        request.mockResolvedValueOnce({
            js: [{ id: '1', title: 'Before reset' }],
        });
        store.selectPlaylist('a');
        await settle();
        request.mockClear();

        store.resetCategories();
        await settle();

        expect(request).not.toHaveBeenCalled();
    });

    it('reloads categories when the active portal cache is explicitly reloaded after a reset', async () => {
        request.mockResolvedValueOnce({
            js: [{ id: '1', title: 'Before reset' }],
        });
        store.selectPlaylist('a');
        await settle();
        request.mockResolvedValueOnce({
            js: [{ id: '1', title: 'After reset' }],
        });
        store.resetCategories();
        store.reloadCategories();
        await settle();
        expect(
            store.getCategoryResource().map((c) => c.category_name)
        ).toContain('After reset');
    });

    it('ignores the abandoned request after switching away and back to the same portal', async () => {
        const old = deferred();
        request.mockReturnValueOnce(old.promise);
        store.selectPlaylist('a');
        await settle();
        store.selectPlaylist('b');
        await settle();
        request.mockResolvedValueOnce({ js: [{ id: '1', title: 'Fresh A' }] });
        store.selectPlaylist('a');
        await settle();
        old.resolve({ js: [{ id: '1', title: 'Obsolete A' }] });
        await settle();
        expect(
            store.getCategoryResource().map((c) => c.category_name)
        ).toContain('Fresh A');
    });

    it('loads the new portal categories even when the previous portal cache is populated', async () => {
        request.mockResolvedValueOnce({ js: [{ id: '1', title: 'Portal A' }] });
        store.selectPlaylist('a');
        await settle();
        expect(request).toHaveBeenCalledTimes(1);
        expect(store.isCategoryResourceFailed()).toBeNull();
        expect(
            store.getCategoryResource().map((c) => c.category_name)
        ).toContain('Portal A');

        request.mockResolvedValueOnce({ js: [{ id: '1', title: 'Portal B' }] });
        store.selectPlaylist('b');
        expect(
            store.getCategoryResource().map((c) => c.category_name)
        ).not.toContain('Portal A');
        await settle();
        expect(
            store.getCategoryResource().map((c) => c.category_name)
        ).toContain('Portal B');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it.each(['success', 'failure'] as const)(
        'ignores a late category %s from the previous portal',
        async (outcome) => {
            const old = deferred();
            request.mockReturnValueOnce(old.promise);
            store.selectPlaylist('a');
            await settle();
            request.mockResolvedValueOnce({
                js: [{ id: '1', title: 'Portal B' }],
            });
            store.selectPlaylist('b');
            await settle();
            if (outcome === 'success')
                old.resolve({ js: [{ id: '1', title: 'Portal A' }] });
            else old.reject(new Error('Old portal offline'));
            await settle();
            expect(
                store.getCategoryResource().map((c) => c.category_name)
            ).toContain('Portal B');
            expect(store.isCategoryResourceFailed()).toBeNull();
        }
    );

    it('does not reuse another section cache from the previous portal', async () => {
        request.mockResolvedValueOnce({ js: [{ id: '1', title: 'A movies' }] });
        store.selectPlaylist('a');
        await settle();
        store.selectType('series');
        request.mockResolvedValueOnce({ js: [{ id: '1', title: 'A series' }] });
        await settle();
        store.selectPlaylist('b');
        request.mockResolvedValueOnce({ js: [{ id: '1', title: 'B series' }] });
        await settle();
        store.selectType('vod');
        request.mockResolvedValueOnce({ js: [{ id: '1', title: 'B movies' }] });
        await settle();
        expect(
            store.getCategoryResource().map((c) => c.category_name)
        ).toContain('B movies');
    });
});
