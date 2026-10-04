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
        selectPlaylist(id: string) {
            patchState(store, {
                currentPlaylist: {
                    _id: id,
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
    beforeEach(() => {
        request = jest.fn().mockResolvedValue({ js: [] });
        TestBed.configureTestingModule({
            providers: [
                Store,
                { provide: DataService, useValue: { sendIpcEvent: request } },
                {
                    provide: ParentalLockService,
                    useValue: { active: () => false, version: () => 0 },
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
                        getChannels: () => null,
                        isReady: () => false,
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

    it('reloads categories when the active portal cache is explicitly reset', async () => {
        request.mockResolvedValueOnce({
            js: [{ id: '1', title: 'Before reset' }],
        });
        store.selectPlaylist('a');
        await settle();
        request.mockResolvedValueOnce({
            js: [{ id: '1', title: 'After reset' }],
        });
        store.resetCategories();
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
