import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import { StalkerPortalDiscoveryService } from './stalker-portal-discovery.service';
import { StalkerSessionService } from './stalker-session.service';

jest.mock('@iptvnator/portal/shared/util', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    }),
}));

const MAC = '00:1A:79:AA:BB:CC';

describe('StalkerPortalDiscoveryService', () => {
    let service: StalkerPortalDiscoveryService;
    let sendIpcEvent: jest.Mock;
    let authenticate: jest.Mock;

    /** Maps probed endpoint URL → resolved value or rejection. */
    function mockProbes(
        handlers: Record<string, { resolve?: unknown; reject?: unknown }>
    ): void {
        sendIpcEvent.mockImplementation((_event, payload) => {
            const { url } = payload as { url: string };
            const handler = handlers[url];
            if (!handler) {
                return Promise.reject(
                    new Error(`unexpected probe for ${url}`)
                );
            }
            if ('reject' in handler) {
                return Promise.reject(handler.reject);
            }
            return Promise.resolve(handler.resolve);
        });
    }

    beforeEach(() => {
        sendIpcEvent = jest.fn();
        authenticate = jest.fn();

        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: { sendIpcEvent } },
                { provide: StalkerSessionService, useValue: { authenticate } },
            ],
        });

        service = TestBed.inject(StalkerPortalDiscoveryService);
    });

    it('resolves a tolerant portal.php panel as a simple portal without authenticating', async () => {
        mockProbes({
            'http://panel.example/portal.php': {
                resolve: { js: [{ id: '1', title: 'News' }] },
            },
        });

        const outcome = await service.discover('http://panel.example/c', MAC);

        expect(outcome).toEqual({
            status: 'resolved',
            portalUrl: 'http://panel.example/portal.php',
            isFullStalkerPortal: false,
        });
        expect(authenticate).not.toHaveBeenCalled();
        // The winning candidate ends discovery — no further probes.
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('falls through a 404 portal.php to server/load.php and classifies by handshake', async () => {
        mockProbes({
            'http://ministra.example/portal.php': {
                reject: { message: 'HTTP Error: Not Found', status: 404 },
            },
            'http://ministra.example/server/load.php': {
                resolve: 'Authorization failed.',
            },
        });
        authenticate.mockResolvedValue({
            token: 'TOKEN1',
            accountInfo: { login: 'user-1' },
        });

        const outcome = await service.discover(
            'http://ministra.example/c',
            MAC,
            { serialNumber: 'SN1' }
        );

        expect(outcome).toEqual({
            status: 'resolved',
            portalUrl: 'http://ministra.example/server/load.php',
            isFullStalkerPortal: true,
            token: 'TOKEN1',
            accountInfo: { login: 'user-1' },
        });
        expect(authenticate).toHaveBeenCalledWith(
            'http://ministra.example/server/load.php',
            MAC,
            { serialNumber: 'SN1' }
        );
    });

    it('resolves a pasted canonical URL in full mode without probing portal.php first', async () => {
        mockProbes({
            'http://ministra.example/server/load.php': {
                resolve: 'Authorization failed.',
            },
        });
        authenticate.mockResolvedValue({ token: 'TOKEN2' });

        const outcome = await service.discover(
            'http://ministra.example/server/load.php',
            MAC
        );

        expect(outcome).toMatchObject({
            status: 'resolved',
            portalUrl: 'http://ministra.example/server/load.php',
            isFullStalkerPortal: true,
        });
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('classifies a token-enforcing portal.php panel as a full portal', async () => {
        // Strict reseller panels exist; behavior beats the URL shape.
        mockProbes({
            'http://strict.example/portal.php': {
                resolve: 'Authorization failed.',
            },
        });
        authenticate.mockResolvedValue({ token: 'TOKEN3' });

        const outcome = await service.discover('http://strict.example/c', MAC);

        expect(outcome).toMatchObject({
            status: 'resolved',
            portalUrl: 'http://strict.example/portal.php',
            isFullStalkerPortal: true,
        });
    });

    it('reports auth-rejected when an endpoint demands auth we cannot complete', async () => {
        mockProbes({
            'http://ministra.example/portal.php': {
                reject: { message: 'HTTP Error: Not Found', status: 404 },
            },
            'http://ministra.example/server/load.php': {
                resolve: 'Authorization failed.',
            },
            'http://ministra.example/stalker_portal/server/load.php': {
                reject: { message: 'HTTP Error: Not Found', status: 404 },
            },
        });
        authenticate.mockRejectedValue(new Error('Profile error: blocked'));

        const outcome = await service.discover(
            'http://ministra.example/c',
            MAC
        );

        expect(outcome).toMatchObject({
            status: 'auth-rejected',
            portalUrl: 'http://ministra.example/server/load.php',
        });
    });

    it('reports unreachable when every candidate 404s', async () => {
        mockProbes({
            'http://empty.example/portal.php': {
                reject: { message: 'HTTP Error: Not Found', status: 404 },
            },
            'http://empty.example/server/load.php': {
                reject: { message: 'HTTP Error: Not Found', status: 404 },
            },
            'http://empty.example/stalker_portal/server/load.php': {
                reject: { message: 'HTTP Error: Not Found', status: 404 },
            },
        });

        const outcome = await service.discover('http://empty.example/c', MAC);

        expect(outcome).toEqual({ status: 'unreachable' });
    });

    it('stops probing after a network-level failure — all candidates share the host', async () => {
        mockProbes({
            'http://down.example/portal.php': {
                reject: {
                    type: 'ERROR',
                    message: 'connect ECONNREFUSED',
                    status: 500,
                },
            },
        });

        const outcome = await service.discover('http://down.example/c', MAC);

        expect(outcome).toEqual({ status: 'unreachable' });
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('skips endpoints that answer with something that is not a portal', async () => {
        mockProbes({
            'http://mixed.example/portal.php': {
                resolve: '<html>It works!</html>',
            },
            'http://mixed.example/server/load.php': {
                resolve: { js: [] },
            },
        });

        const outcome = await service.discover('http://mixed.example/c', MAC);

        expect(outcome).toEqual({
            status: 'resolved',
            portalUrl: 'http://mixed.example/server/load.php',
            isFullStalkerPortal: false,
        });
    });
});
