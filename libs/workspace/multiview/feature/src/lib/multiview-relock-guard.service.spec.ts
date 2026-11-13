import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MultiviewSessionStore } from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import { MultiviewPickerDataService } from './multiview-picker-data.service';
import { liveItem, tile } from './multiview-picker.fixtures';
import { MultiviewRelockGuard } from './multiview-relock-guard.service';
import { MultiviewXtreamLock } from './multiview-xtream-lock';

describe('MultiviewRelockGuard (R11)', () => {
    const version = signal(0);
    const withholdsEverything = signal(false);
    const tiles = signal([
        tile({ id: 'multiview-tile-1', playbackSessionKey: 'own' }),
        tile({ id: 'multiview-tile-2', playbackSessionKey: 'picked' }),
    ]);
    const withhold = jest.fn();
    const locked = new Set<string>();
    const xtreamLocked = new Set<string>();

    beforeEach(() => {
        locked.clear();
        xtreamLocked.clear();
        withhold.mockReset();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ParentalLockService,
                    useValue: { version, withholdsEverything },
                },
                {
                    provide: MultiviewSessionStore,
                    useValue: {
                        tiles,
                        exists: () => true,
                        withhold,
                        tile: (id: string) =>
                            tiles().find((candidate) => candidate.id === id),
                    },
                },
                {
                    provide: MultiviewXtreamLock,
                    useValue: {
                        isLocked: async (item: UnifiedCollectionItem) =>
                            xtreamLocked.has(item.uid),
                    },
                },
                {
                    provide: MultiviewPickerDataService,
                    useValue: {
                        isAllowed: (item: UnifiedCollectionItem) =>
                            !locked.has(item.uid),
                    },
                },
            ],
        });
    });

    function guard(): MultiviewRelockGuard {
        const service = TestBed.inject(MultiviewRelockGuard);
        service.track(
            tile({ id: 'x', playbackSessionKey: 'picked' }),
            liveItem(9)
        );
        TestBed.tick();
        return service;
    }

    it('stops a picked tile once a relock withholds its item', async () => {
        guard();
        expect(withhold).not.toHaveBeenCalled();

        locked.add(liveItem(9).uid);
        version.update((n) => n + 1);
        TestBed.tick();
        await Promise.resolve();
        await Promise.resolve();

        expect(withhold).toHaveBeenCalledWith(['multiview-tile-2']);
    });

    it('stops a picked Xtream tile whose category the data source now locks', async () => {
        guard();
        xtreamLocked.add(liveItem(9).uid);
        version.update((n) => n + 1);
        TestBed.tick();
        await new Promise((resolve) => setTimeout(resolve));

        expect(withhold).toHaveBeenCalledWith(['multiview-tile-2']);
    });

    it('ignores a lock result for a source the tile no longer plays', async () => {
        guard();
        xtreamLocked.add(liveItem(9).uid);
        version.update((n) => n + 1);
        TestBed.tick();
        // The tile is replaced before the check answers.
        tiles.set([
            tile({ id: 'multiview-tile-1', playbackSessionKey: 'own' }),
            tile({ id: 'multiview-tile-2', playbackSessionKey: 'replacement' }),
        ]);
        await new Promise((resolve) => setTimeout(resolve));

        expect(withhold).not.toHaveBeenCalled();
        tiles.set([
            tile({ id: 'multiview-tile-1', playbackSessionKey: 'own' }),
            tile({ id: 'multiview-tile-2', playbackSessionKey: 'picked' }),
        ]);
    });

    it('leaves tiles it did not add to their own view', async () => {
        guard();
        locked.add('xtream::playlist-1::1');
        version.update((n) => n + 1);
        TestBed.tick();
        await new Promise((resolve) => setTimeout(resolve));

        expect(withhold).not.toHaveBeenCalled();
    });
});
