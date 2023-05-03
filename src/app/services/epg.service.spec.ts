import { inject, TestBed } from '@angular/core/testing';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { MockModule, MockProviders } from 'ng-mocks';
import { DataService } from './data.service';
import { EpgService } from './epg.service';

describe('EpgService', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                EpgService,
                MockProviders(DataService, TranslateService, MatSnackBar),
                provideMockStore(),
            ],
            imports: [MockModule(MatSnackBarModule)],
        });
    });

    it('should create a service instance', inject(
        [EpgService],
        (service: EpgService) => {
            expect(service).toBeTruthy();
        }
    ));

    it('should show a notification on epg error', inject(
        [MatSnackBar, EpgService],
        (snackbar: MatSnackBar, service: EpgService) => {
            jest.spyOn(snackbar, 'open');
            service.onEpgError();
            expect(snackbar.open).toHaveBeenCalledTimes(1);
        }
    ));

    it('should handle epg download success', inject(
        [MatSnackBar, MockStore, EpgService],
        (
            snackbar: MatSnackBar,
            channelStore: MockStore,
            service: EpgService
        ) => {
            jest.spyOn(snackbar, 'open');
            jest.spyOn(channelStore, 'dispatch');
            service.onEpgFetchDone();
            expect(snackbar.open).toHaveBeenCalledTimes(1);
            expect(channelStore.dispatch).toHaveBeenCalledWith({
                value: true,
                type: expect.stringContaining('active epg'),
            });
        }
    ));
});
