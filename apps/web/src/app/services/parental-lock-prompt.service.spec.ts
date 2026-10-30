import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { AppParentalLockPromptService } from './parental-lock-prompt.service';

describe('AppParentalLockPromptService', () => {
    const dialog = { open: jest.fn() };
    let service: AppParentalLockPromptService;

    beforeEach(() => {
        jest.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                AppParentalLockPromptService,
                { provide: MatDialog, useValue: dialog },
            ],
        });
        service = TestBed.inject(AppParentalLockPromptService);
    });

    it('loads the PIN dialog on demand and returns the entered PIN', async () => {
        const open = jest.fn(() => ({ afterClosed: () => of('1234') }));
        service.loadPinDialog = jest.fn(async () => ({
            ParentalLockPinDialogComponent: { open },
        })) as never;

        await expect(
            service.requestPin({
                mode: 'set',
                submitKey: 'PARENTAL_LOCK.PIN_DIALOG.SAVE',
            })
        ).resolves.toBe('1234');
        expect(open).toHaveBeenCalledWith(
            dialog,
            expect.objectContaining({
                mode: 'set',
                submitKey: 'PARENTAL_LOCK.PIN_DIALOG.SAVE',
            })
        );
    });

    it('treats a failed dialog chunk load as a cancelled prompt', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        service.loadPinDialog = jest.fn(async () => {
            throw new Error('ChunkLoadError');
        }) as never;

        await expect(
            service.requestPin({ mode: 'unlock' })
        ).resolves.toBeNull();
    });
});
