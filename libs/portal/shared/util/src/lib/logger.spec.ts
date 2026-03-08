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
        jest.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
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
        logPortalDebugEvent(createPortalDebugSuccessEvent(context, { ok: true }));

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
});
