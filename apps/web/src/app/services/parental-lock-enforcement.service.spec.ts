import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { ParentalLockEnforcementService } from './parental-lock-enforcement.service';
import { PlaybackKeepAwakeService } from './playback-keep-awake.service';

interface Applier {
    apply(): Promise<void>;
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
        isXtreamCategoryLocked: jest.fn(() => false),
        isStalkerCategoryLocked: jest.fn(
            (_playlistId: string, _type: string, id: unknown) =>
                id !== null &&
                id !== undefined &&
                lockedStalkerIds.has(String(id))
        ),
        isM3uGroupLocked: jest.fn(() => false),
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
        reloadCategories: jest.fn(async () => undefined),
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

    describe('Stalker', () => {
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
        it('clears a selected item whose category is no longer readable', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            xtreamStore.selectedItem.set({ category_id: 99 });

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.reloadCategories).toHaveBeenCalled();
            expect(xtreamStore.setSelectedItem).toHaveBeenCalledWith(null);
            expect(xtreamStore.setSelectedCategory).not.toHaveBeenCalled();
            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'xtreams',
                'xtream-1',
                'vod',
            ]);
        });

        it('withholds the catalog and a locked detail before the reload on relock', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            parentalLock.active.set(true);
            parentalLock.isXtreamCategoryLocked.mockImplementation(
                (_p: string, _t: string, providerId: number) =>
                    providerId === 70
            );
            xtreamStore.selectedItem.set({ category_id: 7 });
            const order: string[] = [];
            xtreamStore.withholdCatalog.mockImplementation(() =>
                order.push('withhold')
            );
            xtreamStore.setSelectedItem.mockImplementation(() =>
                order.push('step-off')
            );
            xtreamStore.reloadCategories.mockImplementation(async () => {
                order.push('reload');
            });

            await service.applyXtream(parentalLock.version());

            expect(order.slice(0, 3)).toEqual([
                'step-off',
                'withhold',
                'reload',
            ]);
            expect(xtreamStore.clearSearchResults).toHaveBeenCalled();
            expect(parentalLock.isXtreamCategoryLocked).toHaveBeenCalledWith(
                'xtream-1',
                'movies',
                70
            );
            expect(router.navigate).toHaveBeenCalledWith([
                '/workspace',
                'xtreams',
                'xtream-1',
                'vod',
            ]);
        });

        it('does not withhold on unlock, and hands the reloads a publish guard', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod';

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.withholdCatalog).not.toHaveBeenCalled();
            const guard = xtreamStore.reloadCategories.mock.calls[0][0] as
                (() => boolean) | undefined;
            expect(guard?.()).toBe(true);
            parentalLock.version.set(parentalLock.version() + 1);
            expect(guard?.()).toBe(false);
        });

        it('re-runs the stored in-portal search after the reload', async () => {
            router.url = '/workspace/xtreams/xtream-1/search';

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.refreshSearchResults).toHaveBeenCalled();
        });

        it('keeps a selected item whose category survived the lock', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            xtreamStore.selectedCategoryId.set(7);
            xtreamStore.selectedItem.set({ category_id: 7 });

            await service.applyXtream(parentalLock.version());

            expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
            expect(router.navigate).not.toHaveBeenCalled();
        });

        it('steps off a selected category that vanished', async () => {
            router.url = '/workspace/xtreams/xtream-1/live';
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
                    provide: StalkerStore,
                    useValue: { currentPlaylist: signal(null) },
                },
                {
                    provide: Router,
                    useValue: { url: '/', navigate: jest.fn() },
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

        // ...and "Lock now" arrives meanwhile: no second reload starts yet.
        version.set(2);
        TestBed.flushEffects();
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
