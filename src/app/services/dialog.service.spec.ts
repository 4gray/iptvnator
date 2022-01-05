import { ConfirmDialogComponent } from './../shared/components/confirm-dialog/confirm-dialog.component';
import { MockModule, MockComponent } from 'ng-mocks';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { TestBed, inject } from '@angular/core/testing';
import { DialogService } from './dialog.service';
import { ConfirmDialogData } from '../shared/components/confirm-dialog/confirm-dialog.component';
import { EMPTY } from 'rxjs';

describe('Service: Dialog', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            declarations: [MockComponent(ConfirmDialogComponent)],
            providers: [DialogService, MatDialog],
            imports: [MockModule(MatDialogModule)],
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
