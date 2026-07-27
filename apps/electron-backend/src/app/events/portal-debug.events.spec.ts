jest.mock('electron', () => ({
    BrowserWindow: {
        getAllWindows: () => [],
    },
}));

jest.mock('../../environments/environment', () => ({
    environment: {
        production: false,
    },
}));

import { sanitizePortalDebugEvent } from './portal-debug.events';

describe('sanitizePortalDebugEvent', () => {
    it('turns Error objects into plain serializable data', () => {
        const error = new Error('boom');
        (error as Error & { code?: string }).code = 'ECONNREFUSED';

        const event = sanitizePortalDebugEvent({
            requestId: 'req-1',
            provider: 'xtream',
            operation: 'get_account_info',
            transport: 'electron-main',
            startedAt: new Date().toISOString(),
            durationMs: 12,
            status: 'error',
            request: { url: 'http://localhost:3211/player_api.php' },
            error,
        });

        expect(event.error).toEqual(
            expect.objectContaining({
                name: 'Error',
                message: 'boom',
                code: 'ECONNREFUSED',
            })
        );
    });

    it('replaces circular references with markers', () => {
        const request: Record<string, unknown> = {
            method: 'GET',
        };
        request['self'] = request;

        const event = sanitizePortalDebugEvent({
            requestId: 'req-2',
            provider: 'stalker',
            operation: 'get_profile',
            transport: 'electron-main',
            startedAt: new Date().toISOString(),
            durationMs: 4,
            status: 'success',
            request,
            response: { ok: true },
        });

        expect(event.request).toEqual({
            method: 'GET',
            self: '[Circular]',
        });
    });

    it('strips functions from nested debug payloads', () => {
        const event = sanitizePortalDebugEvent({
            requestId: 'req-3',
            provider: 'xtream',
            operation: 'test',
            transport: 'electron-main',
            startedAt: new Date().toISOString(),
            durationMs: 1,
            status: 'success',
            request: {
                headers: {
                    Accept: 'application/json',
                    toJSON: () => 'nope',
                },
            },
            response: undefined,
        });

        expect(event.request).toEqual({
            headers: {
                Accept: 'application/json',
                toJSON: undefined,
            },
        });
    });

    it('redacts credentials in request, response, errors, and URL query params', () => {
        const secrets = {
            username: 'main-user-secret',
            password: 'main-password-secret',
            token: 'main-token-secret',
            authorization: 'main-authorization-secret',
            mac: 'main-mac-secret',
        };
        const event = sanitizePortalDebugEvent({
            requestId: 'req-redaction',
            provider: 'stalker',
            operation: 'get_profile',
            transport: 'electron-main',
            startedAt: new Date().toISOString(),
            durationMs: 5,
            status: 'error',
            request: {
                params: secrets,
                url: `https://example.com/portal?token=${secrets.token}&action=get_profile`,
            },
            error: new Error(
                `Request failed: https://example.com/portal?authorization=${secrets.authorization}&action=get_profile`
            ),
        });

        const output = JSON.stringify(event);
        for (const secret of Object.values(secrets)) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('get_profile');
        expect(output).toContain('req-redaction');
    });
});
