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
    applyXtream(): Promise<void>;
    applyStalker(): Promise<void>;
}

describe('ParentalLockEnforcementService', () => {
    const router = { url: '/', navigate: jest.fn() };
    const lockedStalkerIds = new Set<string>();
    const parentalLock = {
        version: signal(0),
        registerBusyProbe: jest.fn(),
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
        selectedItem: signal<{ category_id?: string } | null>(null),
        clearSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
    };
    const xtreamStore = {
        playlistId: signal<string | null>('xtream-1'),
        selectedCategoryId: signal<number | null>(null),
        selectedItem: signal<{ category_id?: number } | null>(null),
        reloadCategories: jest.fn(async () => undefined),
        reloadCachedContent: jest.fn(async () => undefined),
        getCategoriesBySelectedType: jest.fn(() => [{ id: 7 }, { id: 8 }]),
        setSelectedItem: jest.fn(),
        setSelectedCategory: jest.fn(),
    };
    let service: Applier;

    beforeEach(() => {
        jest.clearAllMocks();
        lockedStalkerIds.clear();
        router.url = '/';
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
        service = TestBed.inject(
            ParentalLockEnforcementService
        ) as unknown as Applier;
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

            await service.applyXtream();

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

        it('keeps a selected item whose category survived the lock', async () => {
            router.url = '/workspace/xtreams/xtream-1/vod/42';
            xtreamStore.selectedCategoryId.set(7);
            xtreamStore.selectedItem.set({ category_id: 7 });

            await service.applyXtream();

            expect(xtreamStore.setSelectedItem).not.toHaveBeenCalled();
            expect(router.navigate).not.toHaveBeenCalled();
        });

        it('steps off a selected category that vanished', async () => {
            router.url = '/workspace/xtreams/xtream-1/live';
            xtreamStore.selectedCategoryId.set(99);

            await service.applyXtream();

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
