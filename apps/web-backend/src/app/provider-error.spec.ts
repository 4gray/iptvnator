import {
    collectProviderErrorCodes,
    logProviderRequestFailure,
    normalizeProviderError,
} from './provider-error';

function errorWithCode(message: string, code: string): Error {
    return Object.assign(new Error(message), { code });
}

describe('collectProviderErrorCodes', () => {
    it('collects the aggregate code and the per-address member codes', () => {
        const aggregate = Object.assign(
            new AggregateError([
                errorWithCode('connect ETIMEDOUT 104.21.0.1:80', 'ETIMEDOUT'),
                errorWithCode(
                    'connect ENETUNREACH 2606:4700::1:80',
                    'ENETUNREACH'
                ),
            ]),
            { code: 'ETIMEDOUT' }
        );

        expect(collectProviderErrorCodes(aggregate)).toEqual([
            'ETIMEDOUT',
            'ENETUNREACH',
        ]);
    });

    it('walks the cause chain', () => {
        const wrapped = new Error('request failed', {
            cause: errorWithCode('getaddrinfo ENOTFOUND host', 'ENOTFOUND'),
        });

        expect(collectProviderErrorCodes(wrapped)).toEqual(['ENOTFOUND']);
    });

    it('survives cyclic error graphs', () => {
        const first = errorWithCode('first', 'ECONNRESET') as Error & {
            cause?: unknown;
        };
        const second = new Error('second', { cause: first });
        first.cause = second;

        expect(collectProviderErrorCodes(second)).toEqual(['ECONNRESET']);
    });

    it('ignores non-string and empty codes', () => {
        expect(
            collectProviderErrorCodes(
                Object.assign(new Error('numeric'), { code: 502 })
            )
        ).toEqual([]);
        expect(
            collectProviderErrorCodes(
                Object.assign(new Error('empty'), { code: '' })
            )
        ).toEqual([]);
        expect(collectProviderErrorCodes(undefined)).toEqual([]);
        expect(collectProviderErrorCodes('ETIMEDOUT')).toEqual([]);
    });
});

describe('normalizeProviderError', () => {
    it('keeps the HTTP response status and statusText untouched', () => {
        const httpError = Object.assign(new Error('Forbidden'), {
            code: 'ERR_BAD_REQUEST',
            response: { status: 403, statusText: 'Forbidden' },
        });

        expect(normalizeProviderError(httpError)).toEqual({
            message: 'Forbidden',
            status: 403,
        });
    });

    it('keeps a statusText-only response on the HTTP branch', () => {
        const partial = Object.assign(new Error('partial'), {
            response: { statusText: 'Gateway Timeout' },
        });

        expect(normalizeProviderError(partial)).toEqual({
            message: 'Gateway Timeout',
            status: 502,
        });
    });

    it('names the network code in message and body for non-HTTP failures', () => {
        expect(
            normalizeProviderError(errorWithCode('timeout', 'ETIMEDOUT'))
        ).toEqual({
            message: 'Bad Gateway (ETIMEDOUT)',
            status: 502,
            code: 'ETIMEDOUT',
        });
    });

    it('falls back to a bare bad gateway when no code exists', () => {
        expect(normalizeProviderError(new Error('boom'))).toEqual({
            message: 'Bad Gateway',
            status: 502,
        });
    });
});

describe('logProviderRequestFailure', () => {
    it('logs hostname and codes but never the URL query string', () => {
        const logger = jest.fn();

        logProviderRequestFailure({
            error: errorWithCode('timeout', 'ETIMEDOUT'),
            route: '/xtream',
            url: 'http://provider.example/player_api.php?username=user&password=pass',
            logger,
        });

        expect(logger).toHaveBeenCalledTimes(1);
        const line = logger.mock.calls[0][0] as string;
        expect(line).toContain('/xtream');
        expect(line).toContain('provider.example');
        expect(line).toContain('ETIMEDOUT');
        expect(line).not.toContain('username');
        expect(line).not.toContain('password');
        expect(line).not.toContain('player_api.php');
    });

    it('describes HTTP failures by numeric status only — the reason phrase is provider-controlled', () => {
        const logger = jest.fn();

        logProviderRequestFailure({
            error: Object.assign(new Error('Unauthorized'), {
                response: {
                    status: 401,
                    statusText:
                        'Unauthorized username=alice&password=secret-pass',
                },
            }),
            route: '/stalker',
            url: new URL('http://portal.example/portal.php'),
            logger,
        });

        const line = logger.mock.calls[0][0] as string;
        expect(line).toContain('HTTP 401');
        expect(line).not.toContain('alice');
        expect(line).not.toContain('secret-pass');
    });

    it('logs a generic HTTP error for a statusText-only response', () => {
        const logger = jest.fn();

        logProviderRequestFailure({
            error: Object.assign(new Error('partial'), {
                response: { statusText: 'Gateway Timeout' },
            }),
            route: '/stalker',
            url: new URL('http://portal.example/portal.php'),
            logger,
        });

        const line = logger.mock.calls[0][0] as string;
        expect(line).toContain('HTTP error');
        expect(line).not.toContain('Gateway Timeout');
    });

    it('tolerates unparseable URLs and codeless errors', () => {
        const logger = jest.fn();

        logProviderRequestFailure({
            error: new Error('boom'),
            route: '/parse',
            url: 'not a url',
            logger,
        });

        const line = logger.mock.calls[0][0] as string;
        expect(line).toContain('<invalid url>');
        expect(line).toContain('unknown network error');
    });
});
