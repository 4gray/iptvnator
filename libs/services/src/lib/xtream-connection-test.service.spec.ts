import {
    EnvironmentInjector,
    Injector,
    createEnvironmentInjector,
    runInInjectionContext,
} from '@angular/core';
import { DataService } from './data.service';
import { XtreamConnectionTestService } from './xtream-connection-test.service';

describe('explicit Xtream connection test', () => {
    const connection = {
        serverUrl: 'https://panel.test/base/get.php?type=m3u',
        username: ' user ',
        password: ' pass ',
    };
    const active = { payload: { user_info: { auth: 1, status: 'Active' } } };
    const refused = {
        connectionFailure: { kind: 'connection', canTryHttp: true },
    };
    let send: jest.Mock;
    let probe: jest.Mock;
    let service: XtreamConnectionTestService;
    beforeEach(() => {
        probe = jest.fn();
        send = jest.fn((type, payload) =>
            type === 'XTREAM_REQUEST' ? probe(payload) : Promise.resolve()
        );
        const injector = createEnvironmentInjector(
            [{ provide: DataService, useValue: { sendIpcEvent: send } }],
            Injector.NULL as unknown as EnvironmentInjector
        );
        service = runInInjectionContext(
            injector,
            () => new XtreamConnectionTestService()
        );
    });

    it('prefers working HTTPS and makes no HTTP request', async () => {
        probe.mockResolvedValue(active);
        expect(await service.test(connection)).toMatchObject({
            status: 'active',
            usedHttpFallback: false,
            serverUrl: 'https://panel.test/base',
        });
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('resets each candidate and returns an authenticated HTTP base for saving', async () => {
        probe.mockResolvedValueOnce(refused).mockResolvedValueOnce(active);
        expect(await service.test(connection)).toMatchObject({
            status: 'active',
            serverUrl: 'http://panel.test/base',
            usedHttpFallback: true,
        });
        expect(probe.mock.calls.map(([p]) => p.url)).toEqual([
            'https://panel.test/base',
            'http://panel.test/base',
        ]);
        expect(probe.mock.calls[1][0]).toMatchObject({
            connectionTest: true,
            params: { username: 'user', password: 'pass' },
        });
        expect(
            send.mock.calls
                .filter(([t]) => t === 'CONNECTIVITY_GUARD_RESET')
                .map(([, p]) => p.url)
        ).toEqual(['https://panel.test/base', 'http://panel.test/base']);
    });

    it.each([
        { connectionFailure: { kind: 'http', status: 403, canTryHttp: false } },
        { connectionFailure: { kind: 'tls', canTryHttp: false } },
        { payload: { user_info: { auth: 0 } } },
        { payload: { user_info: { auth: 1, status: 'Expired' } } },
        { payload: '<html>challenge</html>' },
    ])(
        'does not downgrade a responsive or uncertified portal',
        async (response) => {
            probe.mockResolvedValue(response);
            const result = await service.test(connection);
            expect(result.usedHttpFallback).toBe(false);
            expect(
                probe.mock.calls.every(([p]) => p.url.startsWith('https:'))
            ).toBe(true);
        }
    );

    it('still tries account action variants when the panel omits account info', async () => {
        probe
            .mockResolvedValueOnce({ payload: [] })
            .mockResolvedValueOnce(active);
        expect((await service.test(connection)).status).toBe('active');
        expect(probe.mock.calls[1][0].params).not.toHaveProperty('action');
    });

    it('does not replace the address with an inactive fallback', async () => {
        probe
            .mockResolvedValueOnce(refused)
            .mockResolvedValueOnce({ payload: { user_info: { auth: 0 } } });
        expect(await service.test(connection)).toMatchObject({
            status: 'inactive',
            usedHttpFallback: false,
            serverUrl: 'https://panel.test/base',
        });
    });

    it('does not probe HTTP after the form is edited', async () => {
        let current = true;
        probe.mockImplementation(() => {
            current = false;
            return refused;
        });
        await service.test(connection, () => current);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('fails closed with an old backend or IPC exception', async () => {
        probe.mockRejectedValue(new Error('ECONNREFUSED'));
        expect((await service.test(connection)).usedHttpFallback).toBe(false);
        expect(probe).toHaveBeenCalledTimes(1);
    });
    it('does not downgrade after an earlier account action received a response', async () => {
        probe
            .mockResolvedValueOnce({ payload: [] })
            .mockResolvedValueOnce(refused);
        const result = await service.test(connection);
        expect(result.usedHttpFallback).toBe(false);
        expect(probe).toHaveBeenCalledTimes(2);
        expect(
            probe.mock.calls.every(([p]) => p.url.startsWith('https:'))
        ).toBe(true);
    });

    it('preserves account-action compatibility for a 404 response', async () => {
        probe
            .mockResolvedValueOnce({
                connectionFailure: {
                    kind: 'http',
                    status: 404,
                    canTryHttp: false,
                },
            })
            .mockResolvedValueOnce(active);
        expect((await service.test(connection)).status).toBe('active');
        expect(probe.mock.calls[1][0].params).not.toHaveProperty('action');
    });
});
