import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import {
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { ParentalLockEnforcementService } from './parental-lock-enforcement.service';
import { PlaybackKeepAwakeService } from './playback-keep-awake.service';

interface Applier {
    apply(): Promise<void>;
    failClosedNow(): void;
    applyXtream(version: number): Promise<void>;
    applyStalker(): Promise<void>;
}

describe('ParentalLockEnforcementService', () => {
    const router = { url: '/', navigate: jest.fn() };
    const activeChannel = signal<{ group?: { title: string } } | null>(null);
    const dispatch = jest.fn();
    const lockedStalkerIds = new Set<string>();
    const parentalLock = {
        version: signal(0),
        active: signal(false),
        registerBusyProbe: jest.fn(),
        isXtreamCategoryLocked: jest.fn(
            (_playlistId: string, _type: string, _xtreamId: number) => false
        ),
        isStalkerCategoryLocked: jest.fn(
            (_playlistId: string, _type: string, id: unknown) =>
                id !== null &&
                id !== undefined &&
                lockedStalkerIds.has(String(id))
        ),
        isM3uGroupLocked: jest.fn(
            (_playlistId: string, _groupTitle: string) => false
        ),
    };
    const stalkerStore = {
        currentPlaylist: signal<{ _id: string } | null>({ _id: 'stalker-1' }),
        selectedContentType: signal<string>('vod'),
        selectedCategoryId: signal<string | null>('*'),
        selectedItem: signal<{
            category_id?: string;
            tv_genre_id?: string;
        } | null>(null),
        clearSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
    };
    const xtreamStore = {
        playlistId: signal<string | null>('xtream-1'),
        selectedCategoryId: signal<number | null>(null),
        selectedItem: signal<{ category_id?: number } | null>(null),
        reloadCategories: jest.fn(
            async (_shouldPublish?: () => boolean): Promise<void> => undefined
        ),
        reloadCachedContent: jest.fn(async () => undefined),
        refreshSearchResults: jest.fn(async () => undefined),
        withholdCatalog: jest.fn(),
        clearSearchResults: jest.fn(),
        getCategoriesBySelectedType: jest.fn(() => [
            { id: 7, xtream_id: 70 },
            { id: 8, xtream_id: 80 },
        ]),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
    };
    const xtreamDataSource = {
        getAllCategories: jest.fn(async () => [
            { id: 7, xtream_id: 70 },
            { id: 8, xtream_id: 80 },
            { id: 55, xtream_id: 550 },
            { id: 99, xtream_id: 990 },
        ]),
    };
    let service: Applier;

    beforeEach(() => {
        jest.clearAllMocks();
        lockedStalkerIds.clear();
        router.url = '/';
        parentalLock.active.set(false);
        parentalLock.isXtreamCategoryLocked.mockReturnValue(false);
        stalkerStore.selectedCategoryId.set('*');
        stalkerStore.selectedItem.set(null);
        xtreamStore.selectedCategoryId.set(null);
        xtreamStore.selectedItem.set(null);
        TestBed.configureTestingModule({
            providers: [
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: XtreamStore, useValue: xtreamStore },
                { provide: XTREAM_DATA_SOURCE, useValue: xtreamDataSource },
                { provide: StalkerStore, useValue: stalkerStore },
                { provide: Router, useValue: router },
                {
                    provide: Store,
                    useValue: { selectSignal: () => activeChannel, dispatch },
                },
                {
                    provide: PlaybackKeepAwakeService,
                    useValue: { hasPlayingVideo: () => false },
                },
            ],
        });
        activeChannel.set(null);
        service = TestBed.inject(
            ParentalLockEnforcementService
        ) as unknown as Applier;
    });

    describe('M3U', () => {
        it('resets a locked playing channel before awaiting the portal reloads', async () => {
            router.url = '/workspace/playlists/m3u-1';
            activeChannel.set({ group: { title: 'Adult' } });
            parentalLock.isM3uGroupLocked.mockReturnValue(true);
            let releaseReload: () => void = () => undefined;
            xtreamStore.reloadCategories.mockImplementationOnce(
                () => new Promise<void>((resolve) => (releaseReload = resolve))
            );

            const applying = service.apply();
            await Promise.resolve();

            expect(parentalLock.isM3uGroupLocked).toHaveBeenCalledWith(
                'm3u-1',
                'Adult'
            );
            expect(dispatch).toHaveBeenCalledTimes(1);
            expect(xtreamStore.reloadCategories).toHaveBeenCalledTimes(1);

            releaseReload();
            await applying;
            parentalLock.isM3uGroupLocked.mockReturnValue(false);
        });
    });

    it('resets a channel of a locked group as soon as it becomes active while locked', () => {
        // Numeric zapping, next/previous or a remote command can select a
        // channel without any lock-version change following it.
        router.url = '/workspace/playlists/m3u-1';
        parentalLock.active.set(true);
        parentalLock.isM3uGroupLocked.mockImplementation(
            (_playlistId: string, group: string) => group === 'Adult'
        );
        TestBed.runInInjectionContext(() =>
            (service as unknown as { start(): void }).start()
        );
        TestBed.flushEffects();
        dispatch.mockClear();

        activeChannel.set({ group: { title: 'News' } });
        TestBed.flushEffects();
        expect(dispatch).not.toHaveBeenCalled();

        activeChannel.set({ group: { title: 'Adult' } });
        TestBed.flushEffects();
        expect(dispatch).toHaveBeenCalledTimes(1);
        parentalLock.isM3uGroupLocked.mockReset();
        parentalLock.isM3uGroupLocked.mockReturnValue(false);
    });

    describe('Stalker', () => {
        it('leaves the Stalker route when the Stalker step cannot load', async () => {
            router.url = '/workspace/stalker/stalker-1/itv';
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            (
                service as unknown as {
                    loadStalkerEnforcement: () => Promise<unknown>;
                }
            ).loadStalkerEnforcement = () =>
                Promise.reject(new Error('ChunkLoadError'));

            await expect(service.applyStalker()).resolves.toBeUndefined();

            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'sources',
            ]);
        });

        it('leaves the Stalker route synchronously on relock while the step is not loaded', () => {
            router.url = '/workspace/stalker/stalker-1/itv';
            (
                service as unknown as {
                    loadStalkerEnforcement: () => Promise<unknown>;
                }
            ).loadStalkerEnforcement = () => new Promise(() => undefined);

            service.failClosedNow();

            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'sources',
            ]);
        });

        it('runs a preloaded Stalker step synchronously on relock', async () => {
            router.url = '/workspace/stalker/stalker-1/vod/42';
            await service.applyStalker(); // loads the step
            lockedStalkerIds.add('9');
            stalkerStore.selectedItem.set({ category_id: '9' });
            stalkerStore.clearSelectedItem.mockClear();

            service.failClosedNow();

            expect(stalkerStore.clearSelectedItem).toHaveBeenCalled();
        });

        it('does not load the Stalker step outside a Stalker route', async () => {
            router.url = '/workspace/xtreams/xtream-1/live';
            const load = jest.spyOn(
                service as unknown as { loadStalkerEnforcement: () => unknown },
                'loadStalkerEnforcement'
            );

            await service.applyStalker();

            expect(load).not.toHaveBeenCalled();
            expect(stalkerStore.clearSelectedItem).not.toHaveBeenCalled();
        });

        it('clears a detail opened from All whose own genre is withheld', async () => {
            router.url = '/workspace/stalker/stalker-1/vod/42';
            lockedStalkerIds.add('9');
            stalkerStore.selectedItem.set({ category_id: '9' });

            await service.applyStalker();

            expect(stalkerStore.clearSelectedItem).toHaveBeenCalled();
            // "All" itself is not locked, so the category stays selected.
            expect(stalkerStore.setSelectedCategory).not.toHaveBeenCalled();
            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'stalker',
                'stalker-1',
                'vod',
            ]);
        });

        it('leaves a detail from All alone when its genre is not locked', async () => {
            router.url = '/workspace/stalker/stalker-1/vod/42';
            lockedStalkerIds.add('9');
            stalkerStore.selectedItem.set({ category_id: '3' });

            await service.applyStalker();

            expect(stalkerStore.clearSelectedItem).not.toHaveBeenCalled();
            expect(router.navigate).not.toHaveBeenCalled();
        });

        it('judges a live channel from All by its genre, not by category_id', async () => {
            router.url = '/workspace/stalker/stalker-1/itv';
            stalkerStore.selectedContentType.set('itv');
            lockedStalkerIds.add('9');
            stalkerStore.selectedItem.set({
                tv_genre_id: '9',
                category_id: '3',
            });

            await service.applyStalker();

            expect(stalkerStore.clearSelectedItem).toHaveBeenCalled();
            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'stalker',
                'stalker-1',
                'itv',
            ]);
            stalkerStore.selectedContentType.set('vod');
        });

        it('steps off a locked selected category', async () => {
            router.url = '/workspace/stalker/stalker-1/vod';
            lockedStalkerIds.add('9');
            stalkerStore.selectedCategoryId.set('9');

            await service.applyStalker();

            expect(stalkerStore.clearSelectedItem).toHaveBeenCalled();
            expect(stalkerStore.setSelectedCategory).toHaveBeenCalledWith(null);
        });
    });

    describe('Xtream', () => {
        function lockProvider(providerId: number): void {
            parentalLock.active.set(true);
            parentalLock.isXtreamCategoryLocked.mockImplementation(
                (_p: string, _t: string, id: number) => id === providerId
            );
        }

        it('clears a selected item whose category the lock store withholds', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            lockProvider(990);
            xtreamStore.selectedItem.set({ category_id: 99 });

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.reloadCategories).toHaveBeenCalled();
            expect(xtreamDataSource.getAllCategories).toHaveBeenCalledWith(
                'xtream-1',
                'movies'
            );
            expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
            expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();
            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'xtreams',
                'xtream-1',
                'vod',
            ]);
        });

        it('keeps a detail from a category that is merely hidden, not locked', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            lockProvider(990);
            // Row 55 is absent from the (hidden-filtered) visible list but
            // exists unlocked in the unfiltered rows.
            xtreamStore.selectedItem.set({ category_id: 55 });

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
            expect(router.navigate).not.toHaveBeenCalled();
        });

        it('steps off a selected locked category', async () => {
            router.url = '/workspace/xtreams/xtream-1/live';
            lockProvider(990);
            xtreamStore.selectedCategoryId.set(99);

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
            expect(xtreamStore.setSelectedCategory).toHaveBeenCalledWith(null);
            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'xtreams',
                'xtream-1',
                'live',
            ]);
        });

        it('fails closed when the category rows cannot be read', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            parentalLock.active.set(true);
            xtreamDataSource.getAllCategories.mockRejectedValueOnce(
                new Error('db')
            );
            xtreamStore.selectedItem.set({ category_id: 7 });

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
        });

        it('skips the post-reload checks while unlocked and hands the reloads a publish guard', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod';

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.withholdCatalog).not.toHaveBeenCalled();
            expect(xtreamDataSource.getAllCategories).not.toHaveBeenCalled();
            const guard = xtreamStore.reloadCategories.mock.calls[0][0] as
                (() => boolean) | undefined;
            expect(guard?.()).toBe(true);
            parentalLock.version.set(parentalLock.version() + 1);
            expect(guard?.()).toBe(false);
        });

        it('abandons the reloads and checks once the Xtream playlist is switched', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/7';
            parentalLock.active.set(true);
            xtreamStore.selectedCategoryId.set(7);
            parentalLock.isXtreamCategoryLocked.mockReturnValue(true);
            let guard: () => boolean = () => true;
            (xtreamStore.reloadCategories as jest.Mock).mockImplementationOnce(
                async (shouldPublish: () => boolean) => {
                    guard = shouldPublish;
                    xtreamStore.playlistId.set('xtream-2');
                    router.url = '/workspace/xtreams/xtream-2/vod';
                }
            );

            try {
                await service.applyXtream(parentalLock.version());
                expect(guard()).toBe(false);
                expect(xtreamStore.refreshSearchResults).not.toHaveBeenCalled();
                expect(
                    xtreamDataSource.getAllCategories
                ).not.toHaveBeenCalled();
                expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();
                expect(router.navigate).not.toHaveBeenCalled();
            } finally {
                xtreamStore.playlistId.set('xtream-1');
            }
        });

        it('re-runs the stored in-portal search after the reload', async () => {
            router.url = '/workspace/xtreams/xtream-1/search';

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.refreshSearchResults).toHaveBeenCalled();
        });

        it('clears on relock, synchronously, a detail whose category is not in the visible list', () => {
            // Opened through search from a manually hidden category: the
            // on-screen list cannot place it, and the unfiltered lookup is
            // an awaited read that may hang.
            router.url = '/workspace/xtreams/xtream-1/vod/55/900';
            xtreamStore.selectedItem.set({ category_id: 55 });

            service.failClosedNow();

            expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'xtreams',
                'xtream-1',
                'vod',
            ]);
        });

        it('keeps a detail on relock whose visible category is not locked', () => {
            router.url = '/workspace/xtreams/xtream-1/vod/7/900';
            xtreamStore.selectedItem.set({ category_id: 7 });

            service.failClosedNow();

            expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
        });

        it('fails closed synchronously on relock: detail, catalog and search', () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            lockProvider(70);
            xtreamStore.selectedItem.set({ category_id: 7 });

            service.failClosedNow();

            expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
            expect(xtreamStore.withholdCatalog).toHaveBeenCalled();
            expect(xtreamStore.clearSearchResults).toHaveBeenCalled();
            expect(xtreamStore.reloadCategories).not.toHaveBeenCalled();
        });
    });
});

describe('ParentalLockEnforcementService apply serialization', () => {
    it('runs applies one at a time and abandons a result superseded by a newer version', async () => {
        const version = signal(0);
        let releaseReload: () => void = () => undefined;
        const xtreamStore = {
            playlistId: signal('xtream-1'),
            selectedCategoryId: signal<number | null>(99),
            selectedItem: signal(null),
            reloadCategories: jest.fn(
                () => new Promise<void>((resolve) => (releaseReload = resolve))
            ),
            reloadCachedContent: jest.fn(async () => undefined),
            refreshSearchResults: jest.fn(async () => undefined),
            withholdCatalog: jest.fn(),
            clearSearchResults: jest.fn(),
            getCategoriesBySelectedType: jest.fn(() => [] as unknown[]),
            setSelectedItem: jest.fn(),
            setSelectedCategory: jest.fn(),
        };
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ParentalLockService,
                    useValue: {
                        version,
                        active: signal(true),
                        isXtreamCategoryLocked: jest.fn(() => false),
                        registerBusyProbe: jest.fn(),
                        isStalkerCategoryLocked: jest.fn(() => false),
                        isM3uGroupLocked: jest.fn(() => false),
                    },
                },
                { provide: XtreamStore, useValue: xtreamStore },
                {
                    // No rows: the selected category cannot be placed and
                    // fails closed once an apply gets to judge it.
                    provide: XTREAM_DATA_SOURCE,
                    useValue: { getAllCategories: jest.fn(async () => []) },
                },
                {
                    provide: StalkerStore,
                    useValue: { currentPlaylist: signal(null) },
                },
                {
                    provide: Router,
                    useValue: {
                        url: '/workspace/xtreams/xtream-1/live',
                        navigate: jest.fn(),
                    },
                },
                {
                    provide: Store,
                    useValue: {
                        selectSignal: () => signal(null),
                        dispatch: jest.fn(),
                    },
                },
                {
                    provide: PlaybackKeepAwakeService,
                    useValue: { hasPlayingVideo: () => false },
                },
            ],
        });
        const service = TestBed.inject(ParentalLockEnforcementService);
        TestBed.runInInjectionContext(() => service.start());
        TestBed.flushEffects();

        // Unlock: the reload is held open...
        version.set(1);
        TestBed.flushEffects();
        await Promise.resolve();
        expect(xtreamStore.reloadCategories).toHaveBeenCalledTimes(1);

        // ...and "Lock now" arrives meanwhile: no second reload starts yet,
        // but the catalog is withheld at once rather than behind the hung
        // read.
        xtreamStore.withholdCatalog.mockClear();
        version.set(2);
        TestBed.flushEffects();
        expect(xtreamStore.withholdCatalog).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(xtreamStore.reloadCategories).toHaveBeenCalledTimes(1);

        // The superseded apply must not act on its (unlocked) rows.
        releaseReload();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(xtreamStore.reloadCategories).toHaveBeenCalledTimes(2);
        expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();

        releaseReload();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(xtreamStore.setSelectedCategory).toHaveBeenCalledTimes(1);
    });
});

describe('ParentalLockEnforcementService busy probe', () => {
    it('counts playing audio (the radio player) as activity', () => {
        let probe: (() => boolean) | undefined;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ParentalLockService,
                    useValue: {
                        version: signal(0),
                        registerBusyProbe: (fn: () => boolean) => (probe = fn),
                    },
                },
                { provide: XtreamStore, useValue: {} },
                { provide: XTREAM_DATA_SOURCE, useValue: {} },
                { provide: StalkerStore, useValue: {} },
                { provide: Router, useValue: { url: '/' } },
                {
                    provide: Store,
                    useValue: { selectSignal: () => signal(null) },
                },
                {
                    provide: PlaybackKeepAwakeService,
                    useValue: { hasPlayingVideo: () => false },
                },
            ],
        });
        const service = TestBed.inject(ParentalLockEnforcementService);
        TestBed.runInInjectionContext(() => service.start());
        expect(probe?.()).toBe(false);

        const audio = document.createElement('audio');
        Object.defineProperty(audio, 'paused', { value: false });
        Object.defineProperty(audio, 'ended', { value: false });
        document.body.appendChild(audio);
        try {
            expect(probe?.()).toBe(true);
        } finally {
            audio.remove();
        }
    });
});
