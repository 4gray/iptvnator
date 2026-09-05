import { epgLogger } from './epg-logger';

describe('EPG diagnostics', () => {
    afterEach(() => jest.restoreAllMocks());

    it('omits URLs with arbitrary path/query secrets, redirects and malformed authorities', () => {
        const log = jest.spyOn(console, 'log').mockImplementation();
        epgLogger.log('[EPG Worker]', {
            message:
                'Redirect: https://example.com/path-secret?custom=query-secret -> https://user:password@[/malformed-secret',
            response: { url: new URL('https://example.org/redirect-secret') },
            authorization: 'Bearer header-secret',
            stats: { totalChannels: 12, totalPrograms: 34 },
        });
        const output = JSON.stringify(log.mock.calls);
        for (const secret of [
            'path-secret',
            'query-secret',
            'password',
            'malformed-secret',
            'redirect-secret',
            'header-secret',
        ]) {
            expect(output).not.toContain(secret);
        }
        expect(output).toContain('Redirect:');
        expect(log.mock.calls[0][1]).toEqual(
            expect.objectContaining({
                stats: { totalChannels: 12, totalPrograms: 34 },
            })
        );
    });

    it('omits transport data and stacks while retaining safe error details without mutation', () => {
        const log = jest.spyOn(console, 'error').mockImplementation();
        const error = Object.assign(
            new Error('Failed https://example.org/path-secret'),
            {
                code: 'ECONNRESET',
                cause: new Error(
                    'Redirect https://example.org/redirect-secret'
                ),
                request: {
                    path: '/feed/relative-path-secret?custom=relative-query-secret',
                    _header:
                        'GET /feed/header-path-secret?custom=header-query-secret HTTP/1.1',
                } as { self?: unknown; path: string; _header: string },
            }
        );
        error.request.self = error;
        epgLogger.error('[EPG Worker]', error);
        const output = JSON.stringify(log.mock.calls);
        expect(output).not.toContain('path-secret');
        expect(output).not.toContain('redirect-secret');
        expect(output).toContain('ECONNRESET');
        for (const secret of [
            'relative-path-secret',
            'relative-query-secret',
            'header-path-secret',
            'header-query-secret',
        ]) {
            expect(output).not.toContain(secret);
        }
        expect(log.mock.calls[0][1]).not.toHaveProperty('request');
        expect(log.mock.calls[0][1]).not.toHaveProperty('stack');
        expect(error.message).toBe('Failed https://example.org/path-secret');
        expect(error.request.self).toBe(error);
    });
});
