import {
    createPortalDebugErrorEvent,
    createPortalDebugRequestContext,
    createPortalDebugSuccessEvent,
    logPortalDebugEvent,
    logPortalDebugRequest,
} from './logger';

describe('portal debug logger', () => {
    const globalWithNgDevMode = globalThis as typeof globalThis & {
        ngDevMode?: boolean;
    };
    const originalNgDevMode = globalWithNgDevMode.ngDevMode;

    beforeEach(() => {
        globalWithNgDevMode.ngDevMode = true;
        jest.spyOn(console, 'groupCollapsed').mockImplementation(
            () => undefined
        );
        jest.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        globalWithNgDevMode.ngDevMode = originalNgDevMode;
        jest.restoreAllMocks();
    });

    it('does not log when production is enabled', () => {
        globalWithNgDevMode.ngDevMode = false;

        const context = createPortalDebugRequestContext({
            provider: 'xtream',
            operation: 'get_account_info',
            transport: 'pwa-http',
            request: { url: '/xtream' },
        });

        logPortalDebugRequest(context);
        logPortalDebugEvent(
            createPortalDebugSuccessEvent(context, { ok: true })
        );

        expect(console.groupCollapsed).not.toHaveBeenCalled();
        expect(console.log).not.toHaveBeenCalled();
    });

    it('includes request id and duration in success events', () => {
        const nowSpy = jest
            .spyOn(performance, 'now')
            .mockReturnValueOnce(10)
            .mockReturnValueOnce(18);
        const context = createPortalDebugRequestContext({
            provider: 'stalker',
            operation: 'get_ordered_list',
            transport: 'electron-renderer',
            request: { url: '/stalker' },
        });

        const event = createPortalDebugSuccessEvent(context, { js: [] });

        expect(event.requestId).toBe(context.requestId);
        expect(event.durationMs).toBe(8);
        expect(event.response).toEqual({ js: [] });
        expect(event.status).toBe('success');

        nowSpy.mockRestore();
    });

    it('includes request id and duration in error events', () => {
        const nowSpy = jest
            .spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(112.5);
        const context = createPortalDebugRequestContext({
            provider: 'xtream',
            operation: 'get_vod_info',
            transport: 'pwa-http',
            request: { url: '/xtream' },
        });

        const event = createPortalDebugErrorEvent(context, new Error('boom'));

        expect(event.requestId).toBe(context.requestId);
        expect(event.durationMs).toBe(12.5);
        expect(event.status).toBe('error');
        expect((event.error as Error).message).toBe('boom');

        nowSpy.mockRestore();
    });

    it('redacts portal request and response credentials before logging', () => {
        const secrets = {
            username: 'portal-user-secret',
            password: 'portal-password-secret',
            token: 'portal-token-secret',
            authorization: 'portal-authorization-secret',
            mac: 'portal-mac-secret',
        };
        const context = createPortalDebugRequestContext({
            provider: 'stalker',
            operation: 'get_profile',
            transport: 'pwa-http',
            request: {
                params: secrets,
                url: `https://example.com/portal?token=${secrets.token}&action=get_profile`,
                diagnosticId: 'request-42',
            },
        });

        logPortalDebugRequest(context);
        logPortalDebugEvent(
            createPortalDebugSuccessEvent(context, {
                user_info: secrets,
                status: 'ok',
            })
        );

        const output = JSON.stringify([
            ...(console.log as jest.Mock).mock.calls,
            ...(console.error as jest.Mock).mock.calls,
        ]);
        for (const secret of Object.values(secrets)) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('request-42');
        expect(output).toContain('get_profile');
        expect(output).toContain('status');
    });
});
