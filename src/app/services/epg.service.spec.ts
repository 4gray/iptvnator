import { inject, TestBed } from '@angular/core/testing';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { MockModule, MockProviders } from 'ng-mocks';
import { ChannelStore } from '../state';
import { DataService } from './data.service';
import { EpgService } from './epg.service';

describe('EpgService', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                EpgService,
                MockProviders(DataService, TranslateService, MatSnackBar),
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
        [MatSnackBar, ChannelStore, EpgService],
        (
            snackbar: MatSnackBar,
            channelStore: ChannelStore,
            service: EpgService
        ) => {
            jest.spyOn(snackbar, 'open');
            jest.spyOn(channelStore, 'setEpgAvailableFlag');
            service.onEpgFetchDone();
            expect(snackbar.open).toHaveBeenCalledTimes(1);
            expect(channelStore.setEpgAvailableFlag).toHaveBeenCalledWith(true);
        }
    ));
});
