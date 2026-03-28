import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
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

    it('opens the confirm dialog with the expected config', () => {
        dialog.open.mockReturnValue({
            afterClosed: () => of(false),
        });

        service.openConfirmDialog({
            title: 'Remove',
            message: 'Confirm removal?',
            onConfirm: jest.fn(),
        });

        expect(dialog.open).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                data: expect.objectContaining({
                    title: 'Remove',
                    message: 'Confirm removal?',
                }),
                width: '300px',
            })
        );
    });

    it('invokes onConfirm only after the dialog resolves truthy', () => {
        const onConfirm = jest.fn();
        dialog.open.mockReturnValue({
            afterClosed: () => of(true),
        });

        service.openConfirmDialog({
            title: 'Remove',
            message: 'Confirm removal?',
            onConfirm,
        });

        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
