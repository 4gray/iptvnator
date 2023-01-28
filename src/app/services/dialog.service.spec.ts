import { inject, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MockComponent, MockModule } from 'ng-mocks';
import { EMPTY } from 'rxjs';
import { ConfirmDialogData } from '../shared/components/confirm-dialog/confirm-dialog-data.interface';
import { ConfirmDialogComponent } from './../shared/components/confirm-dialog/confirm-dialog.component';
import { DialogService } from './dialog.service';

describe('Service: Dialog', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [DialogService, MatDialog],
            imports: [
                MockModule(MatDialogModule),
                MockComponent(ConfirmDialogComponent),
            ],
        });
    });

    it('should create the service', inject(
        [DialogService],
        (service: DialogService) => {
            expect(service).toBeTruthy();
        }
    ));

    it('should open a confirm dialog', inject(
        [MatDialog, DialogService],
        (dialog: MatDialog, service: DialogService) => {
            jest.spyOn(dialog, 'open').mockReturnValue({
                afterClosed: () => EMPTY,
            } as any);
            service.openConfirmDialog({
                title: 'Remove dialog',
                message: 'Message',
            } as ConfirmDialogData);
            expect(dialog.open).toHaveBeenCalled();
        }
    ));
});
