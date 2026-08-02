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

    it('treats an HTTP 401/403 probe answer as auth-required, not endpoint-absent', async () => {
        // Non-standard middlewares answer 401 where the stock server sends
        // HTTP 200 + plain text; skipping the candidate would abort imports
        // for portals that previously authenticated directly.
        mockProbes({
            'http://gated.example/portal.php': {
                reject: { message: 'HTTP Error 401: Unauthorized', status: 401 },
            },
        });
        authenticate.mockResolvedValue({ token: 'TOKEN4' });

        const outcome = await service.discover('http://gated.example/c', MAC);

        expect(outcome).toMatchObject({
            status: 'resolved',
            portalUrl: 'http://gated.example/portal.php',
            isFullStalkerPortal: true,
        });
        expect(authenticate).toHaveBeenCalledWith(
            'http://gated.example/portal.php',
            MAC,
            {}
        );
    });

    it('records a 401 candidate as auth-rejected when the handshake is refused', async () => {
        mockProbes({
            'http://gated.example/portal.php': {
                reject: { message: 'HTTP Error 403: Forbidden', status: 403 },
            },
            'http://gated.example/server/load.php': {
                reject: { message: 'HTTP Error 404: Not Found', status: 404 },
            },
            'http://gated.example/stalker_portal/server/load.php': {
                reject: { message: 'HTTP Error 404: Not Found', status: 404 },
            },
        });
        authenticate.mockRejectedValue(new Error('Handshake failed: No token received'));

        const outcome = await service.discover('http://gated.example/c', MAC);

        expect(outcome).toMatchObject({
            status: 'auth-rejected',
            portalUrl: 'http://gated.example/portal.php',
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
        // Post-IPC, a network failure carries no resolvable HTTP status:
        // ipcRenderer strips the object shape and the message has no
        // "HTTP Error NNN" marker.
        mockProbes({
            'http://down.example/portal.php': {
                reject: new Error(
                    "Error invoking remote method 'STALKER_REQUEST': connect ECONNREFUSED"
                ),
            },
        });

        const outcome = await service.discover('http://down.example/c', MAC);

        expect(outcome).toEqual({ status: 'unreachable' });
        expect(sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('keeps probing past a candidate timeout — one handler can hang while siblings work', async () => {
        mockProbes({
            'http://slow.example/portal.php': {
                reject: new Error(
                    "Error invoking remote method 'STALKER_REQUEST': timeout of 15000ms exceeded"
                ),
            },
            'http://slow.example/server/load.php': {
                resolve: { js: [] },
            },
        });

        const outcome = await service.discover('http://slow.example/c', MAC);

        expect(outcome).toEqual({
            status: 'resolved',
            portalUrl: 'http://slow.example/server/load.php',
            isFullStalkerPortal: false,
        });
    });

    it('keeps probing past an endpoint-specific 5xx — the host answered', async () => {
        // One broken handler (a dead portal.php returning 500) must not
        // hide a healthy sibling endpoint on the same host.
        mockProbes({
            'http://flaky.example/portal.php': {
                reject: {
                    message: 'HTTP Error 500: Internal Server Error',
                    status: 500,
                },
            },
            'http://flaky.example/server/load.php': {
                resolve: 'Authorization failed.',
            },
        });
        authenticate.mockResolvedValue({ token: 'TOKEN5' });

        const outcome = await service.discover('http://flaky.example/c', MAC);

        expect(outcome).toMatchObject({
            status: 'resolved',
            portalUrl: 'http://flaky.example/server/load.php',
            isFullStalkerPortal: true,
        });
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
