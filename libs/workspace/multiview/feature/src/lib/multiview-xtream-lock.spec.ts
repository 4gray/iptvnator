import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { XTREAM_DATA_SOURCE } from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { liveItem, movieItem } from './multiview-picker.fixtures';
import { MultiviewXtreamLock } from './multiview-xtream-lock';

describe('MultiviewXtreamLock', () => {
    const active = signal(true);
    const withholdsEverything = signal(false);
    const getContentByXtreamId = jest.fn();

    beforeEach(() => {
        active.set(true);
        withholdsEverything.set(false);
        getContentByXtreamId.mockReset();
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: ParentalLockService,
                    useValue: { active, withholdsEverything },
                },
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: { getContentByXtreamId },
                },
            ],
        });
    });

    const lock = () => TestBed.inject(MultiviewXtreamLock);

    it('asks the data source by stream id, whatever category the row carries', async () => {
        getContentByXtreamId.mockImplementation(
            async (
                _id,
                _playlist,
                _type,
                _identity,
                _category,
                excludeLocked
            ) => (excludeLocked ? null : { id: 1 })
        );

        await expect(
            lock().isLocked(movieItem(4, { categoryId: 3 }))
        ).resolves.toBe(true);
        expect(getContentByXtreamId).toHaveBeenCalledWith(
            4,
            'playlist-1',
            'movie',
            undefined,
            undefined,
            true
        );
    });

    it('allows content the data source still serves', async () => {
        getContentByXtreamId.mockResolvedValue({ id: 1 });

        await expect(lock().isLocked(liveItem(7))).resolves.toBe(false);
    });

    it('does not guess for content the data source does not know', async () => {
        getContentByXtreamId.mockResolvedValue(null);

        await expect(lock().isLocked(liveItem(7))).resolves.toBe(false);
    });

    it('locks everything while the lock state is unavailable', async () => {
        withholdsEverything.set(true);

        await expect(lock().isLocked(liveItem(7))).resolves.toBe(true);
        expect(getContentByXtreamId).not.toHaveBeenCalled();
    });

    it('checks nothing without an active lock or for other providers', async () => {
        active.set(false);
        await expect(lock().isLocked(liveItem(7))).resolves.toBe(false);
        active.set(true);
        await expect(
            lock().isLocked(liveItem(7, { sourceType: 'm3u' }))
        ).resolves.toBe(false);
        expect(getContentByXtreamId).not.toHaveBeenCalled();
    });
});
