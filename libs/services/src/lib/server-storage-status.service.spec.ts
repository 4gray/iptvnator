import { TestBed } from '@angular/core/testing';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import { ServerStorageStatusService } from './server-storage-status.service';

const instance: ServerInstanceInfo = {
    service: 'iptvnator',
    apiVersion: 1,
    instanceId: 'i-1',
    storage: 'server',
    auth: 'none',
};

describe('ServerStorageStatusService', () => {
    let status: ServerStorageStatusService;

    beforeEach(() => {
        status = TestBed.inject(ServerStorageStatusService);
    });

    it('stays inactive and ignores reports until activated', () => {
        status.reportOffline();
        status.reportUnauthorized();

        expect(status.state()).toBe('inactive');
        expect(status.isActive()).toBe(false);
    });

    it('tracks online, offline and unauthorized after activation', () => {
        const retry = jest.fn();
        status.activate(instance, retry);
        expect(status.state()).toBe('online');
        expect(status.instance()).toEqual(instance);

        status.reportOffline();
        expect(status.state()).toBe('offline');
        status.retry();
        expect(retry).toHaveBeenCalledTimes(1);

        status.reportSuccess();
        expect(status.state()).toBe('online');
        expect(status.lastSuccessAt()).toBeInstanceOf(Date);

        status.reportUnauthorized();
        expect(status.state()).toBe('unauthorized');
    });
});
