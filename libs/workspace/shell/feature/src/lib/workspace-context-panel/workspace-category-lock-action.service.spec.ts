import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { ParentalLockService } from '@iptvnator/services';
import { WorkspaceCategoryLockActionService } from './workspace-category-lock-action.service';

describe('WorkspaceCategoryLockActionService', () => {
    const snackBar = { open: jest.fn() };
    const parentalLock = {
        enabled: signal(true),
        requestUnlock: jest.fn(async () => true),
        lockedXtreamIds: jest.fn(() => [7]),
        lockedStalkerIds: jest.fn(() => ['9']),
        setXtreamLocks: jest.fn(
            async (
                ..._args: Parameters<ParentalLockService['setXtreamLocks']>
            ) => true
        ),
        setStalkerLocks: jest.fn(
            async (
                ..._args: Parameters<ParentalLockService['setStalkerLocks']>
            ) => true
        ),
    };
    let service: WorkspaceCategoryLockActionService;

    beforeEach(() => {
        jest.clearAllMocks();
        parentalLock.requestUnlock.mockResolvedValue(true);
        parentalLock.setXtreamLocks.mockResolvedValue(true);
        TestBed.configureTestingModule({
            providers: [
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: MatSnackBar, useValue: snackBar },
                {
                    provide: TranslateService,
                    useValue: { instant: (key: string) => key },
                },
            ],
        });
        service = TestBed.inject(WorkspaceCategoryLockActionService);
    });

    it('reads the Xtream lock state through the provider id', () => {
        const base = {
            provider: 'xtreams' as const,
            playlistId: 'p',
            section: 'vod',
        };
        expect(
            service.isLocked({ ...base, item: { id: 1, xtream_id: 7 } })
        ).toBe(true);
        expect(service.isLocked({ ...base, item: { category_id: '7' } })).toBe(
            true
        );
        expect(
            service.isLocked({ ...base, item: { id: 2, xtream_id: 8 } })
        ).toBe(false);
        expect(parentalLock.lockedXtreamIds).toHaveBeenCalledWith(
            'p',
            'movies'
        );
    });

    it('adds and removes one Xtream category as an edit of the current list', async () => {
        const target = {
            provider: 'xtreams' as const,
            playlistId: 'p',
            section: 'live',
            item: { id: 2, xtream_id: 8 },
        };
        await expect(service.setLocked(target, true)).resolves.toBe(true);
        const [, type, edit] = parentalLock.setXtreamLocks.mock
            .calls[0] as unknown as [
            string,
            string,
            (current: number[]) => number[],
        ];
        expect(type).toBe('live');
        // Applied inside the store's queue to whatever is current THEN.
        expect(edit([7])).toEqual([7, 8]);
        expect(edit([7, 8])).toEqual([7, 8]);

        await service.setLocked(
            { ...target, item: { id: 1, xtream_id: 7 } },
            false
        );
        const unlock = parentalLock.setXtreamLocks.mock
            .calls[1][2] as unknown as (current: number[]) => number[];
        expect(unlock([7, 8])).toEqual([8]);
    });

    it('toggles a Stalker genre and never the All pseudo-category', async () => {
        const target = {
            provider: 'stalker' as const,
            playlistId: 'p',
            section: 'itv',
            item: { category_id: '5' },
        };
        expect(
            service.isLocked({ ...target, item: { category_id: '9' } })
        ).toBe(true);
        await expect(service.setLocked(target, true)).resolves.toBe(true);
        const edit = parentalLock.setStalkerLocks.mock
            .calls[0][2] as unknown as (current: string[]) => string[];
        expect(edit(['9'])).toEqual(['9', '5']);
        await expect(
            service.setLocked({ ...target, item: { category_id: '*' } }, true)
        ).resolves.toBe(false);
    });

    it('does nothing when the PIN is refused and reports a failed write', async () => {
        const target = {
            provider: 'xtreams' as const,
            playlistId: 'p',
            section: 'live',
            item: { xtream_id: 8 },
        };
        parentalLock.requestUnlock.mockResolvedValueOnce(false);
        await expect(service.setLocked(target, true)).resolves.toBe(false);
        expect(parentalLock.setXtreamLocks).not.toHaveBeenCalled();

        parentalLock.setXtreamLocks.mockResolvedValueOnce(false);
        await expect(service.setLocked(target, true)).resolves.toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'PARENTAL_LOCK.SAVE_FAILED',
            'CLOSE',
            expect.any(Object)
        );
    });
});
