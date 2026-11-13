import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MultiviewSessionStore } from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import { MultiviewPickerDataService } from './multiview-picker-data.service';
import { liveItem, tile } from './multiview-picker.fixtures';
import { MultiviewRelockGuard } from './multiview-relock-guard.service';

describe('MultiviewRelockGuard (R11)', () => {
    const version = signal(0);
    const withholdsEverything = signal(false);
    const tiles = signal([
        tile({ id: 'multiview-tile-1', playbackSessionKey: 'own' }),
        tile({ id: 'multiview-tile-2', playbackSessionKey: 'picked' }),
    ]);
    const withhold = jest.fn();
    const locked = new Set<string>();

    beforeEach(() => {
        locked.clear();
        withhold.mockReset();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ParentalLockService,
                    useValue: { version, withholdsEverything },
                },
                {
                    provide: MultiviewSessionStore,
                    useValue: { tiles, exists: () => true, withhold },
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

    it('stops a picked tile once a relock withholds its item', () => {
        guard();
        expect(withhold).not.toHaveBeenCalled();

        locked.add(liveItem(9).uid);
        version.update((n) => n + 1);
        TestBed.tick();

        expect(withhold).toHaveBeenCalledWith(['multiview-tile-2']);
    });

    it('leaves tiles it did not add to their own view', () => {
        guard();
        locked.add('xtream::playlist-1::1');
        version.update((n) => n + 1);
        TestBed.tick();

        expect(withhold).not.toHaveBeenCalled();
    });
});
