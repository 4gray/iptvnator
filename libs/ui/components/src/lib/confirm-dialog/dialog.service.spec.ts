import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { DialogService } from './dialog.service';

describe('DialogService', () => {
    let service: DialogService;
    let dialog: { open: jest.Mock };

    beforeEach(() => {
        dialog = {
            open: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                DialogService,
                {
                    provide: MatDialog,
                    useValue: dialog,
                },
            ],
        });

        service = TestBed.inject(DialogService);
    });

    it('opens the confirm dialog with the expected config once its chunk is in', async () => {
        dialog.open.mockReturnValue({
            afterClosed: () => of(false),
        });

        await service.openConfirmDialog({
            title: 'Remove',
            message: 'Confirm removal?',
            confirmLabel: 'Remove playlist',
            onConfirm: jest.fn(),
        });

        expect(dialog.open).toHaveBeenCalledWith(
            ConfirmDialogComponent,
            expect.objectContaining({
                data: expect.objectContaining({
                    title: 'Remove',
                    message: 'Confirm removal?',
                }),
                width: '420px',
                maxWidth: 'calc(100vw - 32px)',
            })
        );
    });

    it('uses a custom dialog width when provided', async () => {
        dialog.open.mockReturnValue({
            afterClosed: () => of(false),
        });

        await service.openConfirmDialog({
            title: 'Refresh Xtream Playlist',
            message: 'Confirm refresh?',
            confirmLabel: 'Refresh playlist',
            width: '400px',
            onConfirm: jest.fn(),
        });

        expect(dialog.open).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                width: '400px',
            })
        );
    });

    it('invokes onConfirm only after the dialog resolves truthy', async () => {
        const onConfirm = jest.fn();
        dialog.open.mockReturnValue({
            afterClosed: () => of(true),
        });

        await service.openConfirmDialog({
            title: 'Remove',
            message: 'Confirm removal?',
            confirmLabel: 'Remove playlist',
            onConfirm,
        });

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    it('does not repeat a persistent dialog action on programmatic close', async () => {
        const onConfirm = jest.fn();
        dialog.open.mockReturnValue({ afterClosed: () => of(true) });
        await service.openConfirmDialog({
            title: 'Recovery',
            message: 'Path',
            confirmLabel: 'Copy path',
            keepOpenOnConfirm: true,
            onConfirm,
        });
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('logs a failed chunk load and performs no action', async () => {
        const error = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const onConfirm = jest.fn();
        service.loadConfirmDialog = () =>
            Promise.reject(new Error('chunk failed'));

        await service.openConfirmDialog({
            title: 'Remove',
            message: 'Confirm removal?',
            confirmLabel: 'Remove playlist',
            onConfirm,
        });

        expect(dialog.open).not.toHaveBeenCalled();
        expect(onConfirm).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });
});
