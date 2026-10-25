import { TestBed } from '@angular/core/testing';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';
import {
    readServerAccessToken,
    SERVER_ACCESS_TOKEN_STORAGE_KEY,
    writeServerAccessToken,
} from './server-access-token';
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

        // Late answers to requests sent with the old token.
        status.reportSuccess();
        status.reportOffline();
        expect(status.state()).toBe('unauthorized');
    });

    it('ignores a refusal of a token replaced since', () => {
        status.activate(instance, jest.fn());
        writeServerAccessToken('new', 'i-1');

        status.reportAccessDenied('old');
        expect(status.state()).toBe('online');
        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe(
            'new'
        );

        status.reportAccessDenied('new');
        expect(status.state()).toBe('unauthorized');
        expect(
            localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
        ).toBeNull();
    });

    it("sends no other instance's token and asks for this one's", () => {
        status.activate(instance, jest.fn());
        // Another tab signed in to the server a new backend URL leads to.
        writeServerAccessToken('new-server', 'i-2');

        expect(status.accessToken()).toBeNull();
        status.reportAccessDenied(null);

        expect(status.state()).toBe('unauthorized');
        expect(readServerAccessToken('i-2')).toBe('new-server');
    });

    it('keeps the token of a page that holds it back on a refusal', () => {
        status.activate(instance, jest.fn(), false);
        writeServerAccessToken('kept', 'i-1');

        expect(status.accessToken()).toBeNull();
        status.reportAccessDenied(null);

        expect(status.state()).toBe('online');
        expect(readServerAccessToken('i-1')).toBe('kept');
    });

    it('checks the instance again after an outage on the sign-in page', () => {
        status.activate(instance, jest.fn());
        status.reportUnauthorized();

        status.reportOffline();

        expect(status.state()).toBe('unauthorized');
        expect(status.isVerified()).toBe(false);
    });
});
