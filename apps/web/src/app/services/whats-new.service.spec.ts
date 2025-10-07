/* eslint-disable @typescript-eslint/unbound-method */
import { TestBed, inject } from '@angular/core/testing';
import { WhatsNewService } from './whats-new.service';

describe('Service: WhatsNew', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [WhatsNewService],
        });
    });

    it('should ...', inject([WhatsNewService], (service: WhatsNewService) => {
        expect(service).toBeTruthy();
    }));

    it('should change the state', inject(
        [WhatsNewService],
        (service: WhatsNewService) => {
            jest.spyOn(service.dialogState$, 'next');
            service.changeDialogVisibleState(true);
            expect(service.dialogState$.next).toHaveBeenCalledTimes(1);
            expect(service.dialogState$.next).toHaveBeenCalledWith(true);
            service.changeDialogVisibleState(false);
            expect(service.dialogState$.next).toHaveBeenCalledTimes(2);
            expect(service.dialogState$.next).toHaveBeenCalledWith(false);
        }
    ));

    it('should return modal windows for the requested version ', inject(
        [WhatsNewService],
        (service: WhatsNewService) => {
            const version = '0.6.0';
            const modals = service.getModalsByVersion(version);
            expect(modals).toBeDefined();
            expect(modals).toHaveLength(service.modals[version].length);
        }
    ));
});
