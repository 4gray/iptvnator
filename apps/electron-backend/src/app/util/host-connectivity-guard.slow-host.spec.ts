/**
 * The guard against a real socket: a panel that accepts the connection and
 * then never answers (the "connection keeps dropping" reports) versus a port
 * nothing listens on. Real axios, real loopback servers, short timeouts.
 */

import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
    beginGuardedHostRequest,
    releaseGuardedHostRequest,
    reportGuardedHostFailure,
    resetHostConnectivityGuardForTests,
} from './host-connectivity-guard';
import { requestWithValidatedRedirects } from './validated-axios';

const REQUEST_TIMEOUT_MS = 150;

async function withSilentServer<T>(
    run: (origin: string) => Promise<T>
): Promise<T> {
    const server: Server = createServer(() => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        return await run(
            `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        );
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

/** One guarded request the way the Xtream handler issues it. */
async function guardedRequest(origin: string): Promise<string | undefined> {
    const url = `${origin}/player_api.php?action=get_vod_info`;
    let connected = false;
    const token = beginGuardedHostRequest(url);
    try {
        await requestWithValidatedRedirects(
            url,
            {
                method: 'GET',
                timeout: REQUEST_TIMEOUT_MS,
                onConnect: () => {
                    connected = true;
                },
            },
            { allowPrivateNetworks: true }
        );
        return undefined;
    } catch (error) {
        reportGuardedHostFailure(token, error, {
            requestUrl: url,
            connected,
        });
        return (error as { code?: string }).code;
    } finally {
        releaseGuardedHostRequest(token);
    }
}

describe('host connectivity guard against a real socket', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        resetHostConnectivityGuardForTests();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
        resetHostConnectivityGuardForTests();
    });

    it('keeps admitting a panel that accepts connections but never answers', async () => {
        await withSilentServer(async (origin) => {
            expect(await guardedRequest(origin)).toBe('ECONNABORTED');
            expect(await guardedRequest(origin)).toBe('ECONNABORTED');

            // Before the fix these two timeouts opened the breaker and this
            // third attempt threw the fast-fail without touching the socket.
            expect(() =>
                releaseGuardedHostRequest(
                    beginGuardedHostRequest(`${origin}/player_api.php`)
                )
            ).not.toThrow();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });

    it('still opens for a host that never accepts the connection', async () => {
        const origin = await withSilentServer(async (origin) => origin);

        expect(await guardedRequest(origin)).toBe('ECONNREFUSED');
        expect(await guardedRequest(origin)).toBe('ECONNREFUSED');

        expect(() =>
            beginGuardedHostRequest(`${origin}/player_api.php`)
        ).toThrow(/not responding/);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('is not answering')
        );
    });
});
