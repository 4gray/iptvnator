import axios, { AxiosError } from 'axios';
import { StalkerCookieJar } from './stalker-cookie-jar';
import {
    STALKER_HTTP_REQUEST_MODES,
    StalkerHttpSession,
    type StalkerHttpRequestOutcome,
} from './stalker-http-session';

jest.mock('axios', () => {
    const actual = jest.requireActual<typeof import('axios')>('axios');
    return {
        ...actual,
        __esModule: true,
        default: Object.assign(jest.fn(), actual.default),
    };
});

const axiosMock = axios as unknown as jest.Mock;
const DEFAULT_TRANSPORT = {
    maxResponseBytes: 1024,
    timeoutMs: 2500,
};

function expectNoSecretEcho(
    outcome: StalkerHttpRequestOutcome,
    secrets: readonly string[]
): void {
    const serialized = JSON.stringify(outcome);
    for (const secret of secrets) {
        expect(serialized).not.toContain(secret);
    }
}

describe('StalkerHttpSession', () => {
    beforeEach(() => {
        axiosMock.mockReset();
    });

    it('uses bounded arraybuffer transport, Axios params, pinned LAN policy, and preserves HTTP statuses', async () => {
        axiosMock.mockImplementationOnce(async (config) => ({
            config,
            data: Buffer.from('denied', 'utf8'),
            headers: {},
            status: 403,
        }));
        const session = new StalkerHttpSession(
            new StalkerCookieJar(),
            DEFAULT_TRANSPORT
        );

        const outcome = await session.request({
            mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
            params: {
                action: 'handshake',
                type: 'stb',
            },
            url: 'http://192.168.1.20/server/load.php#ignored',
        });

        expect(outcome.kind).toBe('success');
        if (outcome.kind !== 'success') {
            throw new Error('Expected transport success');
        }
        expect(outcome.result).toMatchObject({
            finalUrl: 'http://192.168.1.20/server/load.php',
            status: 403,
        });
        expect(Buffer.from(outcome.result.body).toString('utf8')).toBe(
            'denied'
        );

        expect(axiosMock).toHaveBeenCalledTimes(1);
        const config = axiosMock.mock.calls[0][0];
        expect(config).toMatchObject({
            maxBodyLength: DEFAULT_TRANSPORT.maxResponseBytes,
            maxContentLength: DEFAULT_TRANSPORT.maxResponseBytes,
            maxRedirects: 0,
            method: 'GET',
            params: {
                action: 'handshake',
                type: 'stb',
            },
            proxy: false,
            responseType: 'arraybuffer',
            timeout: DEFAULT_TRANSPORT.timeoutMs,
            url: 'http://192.168.1.20/server/load.php',
        });
        expect(config.validateStatus(403)).toBe(true);
        expect(config.validateStatus(500)).toBe(true);
        expect(config.httpAgent).toBeDefined();
        expect(config.headers).not.toHaveProperty('Authorization');
        expect(config.headers).not.toHaveProperty('Cookie');
        expect(config.headers).not.toHaveProperty('Proxy-Authorization');
    });

    it.each([200, 401, 404, 429, 500, 503])(
        'returns HTTP %i as a successful transport result',
        async (status) => {
            axiosMock.mockResolvedValueOnce({
                data: Buffer.from('{}'),
                headers: {},
                status,
            });
            const session = new StalkerHttpSession(
                new StalkerCookieJar(),
                DEFAULT_TRANSPORT
            );

            const outcome = await session.request({
                mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
                url: 'http://10.0.0.20/server/load.php',
            });

            expect(outcome).toMatchObject({
                kind: 'success',
                result: { status },
            });
        }
    );

    it('prepares and collects the cookie jar on every same-origin hop without flattening Set-Cookie arrays', async () => {
        const jar = new StalkerCookieJar({
            mac: '00:1A:79:00:00:01',
            stb_lang: 'en',
            timezone: 'UTC',
        });
        await jar.collectResponseCookies(
            'http://192.168.1.20/server/load.php',
            ['seed=present; Path=/']
        );
        const getCookieHeader = jest.spyOn(jar, 'getCookieHeader');
        const collectResponseCookies = jest.spyOn(
            jar,
            'collectResponseCookies'
        );
        axiosMock
            .mockResolvedValueOnce({
                data: Buffer.alloc(0),
                headers: {
                    location: '/server/next.php',
                    'set-cookie': ['first=one; Path=/', 'second=two; Path=/'],
                },
                status: 302,
            })
            .mockResolvedValueOnce({
                data: Buffer.from('{"js":{}}'),
                headers: {
                    'set-cookie': ['final=three; Path=/'],
                },
                status: 200,
            });
        const session = new StalkerHttpSession(jar, DEFAULT_TRANSPORT);

        const outcome = await session.request({
            headers: {
                Authorization: 'Bearer same-origin-token',
                Cookie: 'caller-cookie=must-not-win',
                'Proxy-Authorization': 'Basic must-not-be-sent',
                'X-User-Agent': 'Model: MAG250',
            },
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: { action: 'get_profile', type: 'stb' },
            url: 'http://192.168.1.20/server/load.php',
        });

        expect(outcome.kind).toBe('success');
        expect(getCookieHeader).toHaveBeenNthCalledWith(
            1,
            'http://192.168.1.20/server/load.php'
        );
        expect(getCookieHeader).toHaveBeenNthCalledWith(
            2,
            'http://192.168.1.20/server/next.php'
        );
        expect(collectResponseCookies).toHaveBeenNthCalledWith(
            1,
            'http://192.168.1.20/server/load.php',
            ['first=one; Path=/', 'second=two; Path=/']
        );
        expect(collectResponseCookies).toHaveBeenNthCalledWith(
            2,
            'http://192.168.1.20/server/next.php',
            ['final=three; Path=/']
        );

        const firstHeaders = axiosMock.mock.calls[0][0].headers;
        const secondHeaders = axiosMock.mock.calls[1][0].headers;
        expect(firstHeaders.Authorization).toBe('Bearer same-origin-token');
        expect(firstHeaders.Cookie).toContain('seed=present');
        expect(firstHeaders.Cookie).not.toContain('caller-cookie');
        expect(firstHeaders).not.toHaveProperty('Proxy-Authorization');
        expect(secondHeaders.Authorization).toBe('Bearer same-origin-token');
        expect(secondHeaders.Cookie).toContain('first=one');
        expect(secondHeaders.Cookie).toContain('second=two');
        expect(secondHeaders.Cookie).toContain('mac=00:1A:79:00:00:01');
    });

    it('keeps anonymous requests free of identity headers and managed credentials', async () => {
        axiosMock.mockResolvedValueOnce({
            data: Buffer.from('{}'),
            headers: {},
            status: 200,
        });
        const session = new StalkerHttpSession(
            new StalkerCookieJar(),
            DEFAULT_TRANSPORT
        );

        await session.request({
            mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
            params: { probe: 'landing' },
            url: 'http://172.16.0.10/c/',
        });

        const config = axiosMock.mock.calls[0][0];
        expect(config.params).toEqual({ probe: 'landing' });
        expect(
            Object.keys(config.headers).map((name) => name.toLowerCase())
        ).not.toEqual(
            expect.arrayContaining([
                'authorization',
                'cookie',
                'proxy-authorization',
                'sn',
                'x-user-agent',
            ])
        );
    });

    it('pauses an identity-bearing cross-origin redirect before target preparation or contact', async () => {
        const secrets = [
            'Bearer source-secret',
            'caller-cookie-secret',
            'proxy-secret',
            'provider-user',
            'provider-password',
            '00:1A:79:00:00:09',
        ];
        const jar = new StalkerCookieJar({
            mac: '00:1A:79:00:00:09',
            stb_lang: 'en',
            timezone: 'UTC',
        });
        const getCookieHeader = jest.spyOn(jar, 'getCookieHeader');
        const collectResponseCookies = jest.spyOn(
            jar,
            'collectResponseCookies'
        );
        axiosMock.mockResolvedValueOnce({
            data: Buffer.alloc(0),
            headers: {
                location: 'http://192.168.2.30/landing?display=portal',
                'set-cookie': [
                    'landing=retained-before-pause; Path=/',
                    'route=blue; Path=/',
                ],
            },
            status: 302,
        });
        const session = new StalkerHttpSession(jar, DEFAULT_TRANSPORT);

        const outcome = await session.request({
            headers: {
                Authorization: 'Bearer source-secret',
                Cookie: 'caller-cookie-secret',
                'Proxy-Authorization': 'Basic proxy-secret',
                'X-User-Agent': 'Model: MAG250',
            },
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: {
                login: 'provider-user',
                mac: '00:1A:79:00:00:09',
                password: 'provider-password',
            },
            url: 'http://192.168.1.20/server/load.php',
        });

        expect(outcome).toEqual({
            finalOrigin: 'http://192.168.2.30',
            kind: 'origin-approval-required',
            sourceOrigin: 'http://192.168.1.20',
        });
        expectNoSecretEcho(outcome, secrets);
        expect(axiosMock).toHaveBeenCalledTimes(1);
        expect(getCookieHeader).toHaveBeenCalledTimes(1);
        expect(collectResponseCookies).toHaveBeenCalledWith(
            'http://192.168.1.20/server/load.php',
            ['landing=retained-before-pause; Path=/', 'route=blue; Path=/']
        );

        const sourceConfig = axiosMock.mock.calls[0][0];
        expect(sourceConfig.headers.Authorization).toBe('Bearer source-secret');
        expect(sourceConfig.headers.Cookie).toContain('mac=00:1A:79:00:00:09');
        expect(sourceConfig.headers.Cookie).not.toContain(
            'caller-cookie-secret'
        );
        expect(sourceConfig.headers).not.toHaveProperty('Proxy-Authorization');
    });

    it.each([
        'http://portal-user:portal-password@192.168.1.20/server/load.php',
        'http://192.168.1.20/server/load.php?token=query-secret',
        'http://192.168.1.20/server/load.php?USERNAME=query-secret',
        'http://192.168.1.20/server/load.php?mac=00:1A:79:00:00:07',
    ])(
        'rejects an unsafe initial target without contact or secret echo',
        async (url) => {
            const session = new StalkerHttpSession(
                new StalkerCookieJar(),
                DEFAULT_TRANSPORT
            );

            const outcome = await session.request({
                mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
                url,
            });

            expect(outcome).toEqual({
                kind: 'failure',
                reason: 'invalid-url',
                retryable: false,
            });
            expectNoSecretEcho(outcome, [
                'portal-user',
                'portal-password',
                'query-secret',
                '00:1A:79:00:00:07',
            ]);
            expect(axiosMock).not.toHaveBeenCalled();
        }
    );

    it.each([
        'http://redirect-user:redirect-password@192.168.2.30/landing',
        'http://192.168.2.30/landing?authorization=redirect-secret',
        'http://192.168.2.30/landing?device_id=redirect-secret',
    ])(
        'rejects an unsafe redirect before target contact or secret echo',
        async (location) => {
            axiosMock.mockResolvedValueOnce({
                data: Buffer.alloc(0),
                headers: { location },
                status: 302,
            });
            const session = new StalkerHttpSession(
                new StalkerCookieJar(),
                DEFAULT_TRANSPORT
            );

            const outcome = await session.request({
                mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
                url: 'http://192.168.1.20/server/load.php',
            });

            expect(outcome).toEqual({
                kind: 'failure',
                reason: 'invalid-url',
                retryable: false,
            });
            expectNoSecretEcho(outcome, [
                'redirect-user',
                'redirect-password',
                'redirect-secret',
            ]);
            expect(axiosMock).toHaveBeenCalledTimes(1);
        }
    );

    it('checks the actual response byte length even when an adapter ignores maxContentLength', async () => {
        const responseSecret = '12345';
        axiosMock.mockResolvedValueOnce({
            data: Buffer.from(responseSecret),
            headers: {},
            status: 200,
        });
        const session = new StalkerHttpSession(new StalkerCookieJar(), {
            maxResponseBytes: 4,
            timeoutMs: 1000,
        });

        const outcome = await session.request({
            mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
            url: 'http://192.168.1.20/server/load.php',
        });

        expect(outcome).toEqual({
            kind: 'failure',
            reason: 'response-too-large',
            retryable: false,
        });
        expectNoSecretEcho(outcome, [responseSecret]);
        expect(axiosMock.mock.calls[0][0]).toMatchObject({
            maxBodyLength: 4,
            maxContentLength: 4,
        });
    });

    it.each([
        {
            transport: {
                maxResponseBytes: 1024,
                timeoutMs: Number.POSITIVE_INFINITY,
            },
        },
        {
            transport: {
                maxResponseBytes: Number.NaN,
                timeoutMs: 1000,
            },
        },
        {
            transport: {
                maxResponseBytes: 0,
                timeoutMs: 1000,
            },
        },
    ])(
        'rejects non-finite or non-positive transport bounds before contact',
        async ({ transport }) => {
            const session = new StalkerHttpSession(
                new StalkerCookieJar(),
                transport
            );

            const outcome = await session.request({
                mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
                url: 'http://192.168.1.20/server/load.php',
            });

            expect(outcome).toEqual({
                kind: 'failure',
                reason: 'invalid-identity-input',
                retryable: false,
            });
            expect(axiosMock).not.toHaveBeenCalled();
        }
    );

    it.each([
        {
            error: Object.assign(
                new Error(
                    'request to http://portal/?token=transport-secret timed out'
                ),
                { code: 'ETIMEDOUT' }
            ),
            expected: {
                kind: 'failure',
                reason: 'request-timeout',
                retryable: true,
            },
        },
        {
            error: new AxiosError(
                'maxContentLength size of transport-secret exceeded',
                'ERR_BAD_RESPONSE'
            ),
            expected: {
                kind: 'failure',
                reason: 'response-too-large',
                retryable: false,
            },
        },
    ])(
        'maps transport failures to stable redacted outcomes',
        async ({ error, expected }) => {
            axiosMock.mockRejectedValueOnce(error);
            const session = new StalkerHttpSession(
                new StalkerCookieJar(),
                DEFAULT_TRANSPORT
            );

            const outcome = await session.request({
                mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
                url: 'http://192.168.1.20/server/load.php',
            });

            expect(outcome).toEqual(expected);
            expectNoSecretEcho(outcome, ['transport-secret']);
        }
    );

    it('returns undecoded bytes so strict UTF-8 and JSON consumers run only after the cap', async () => {
        const invalidUtf8 = Buffer.from([0xc3, 0x28]);
        axiosMock.mockResolvedValueOnce({
            data: invalidUtf8,
            headers: {},
            status: 200,
        });
        const session = new StalkerHttpSession(
            new StalkerCookieJar(),
            DEFAULT_TRANSPORT
        );

        const outcome = await session.request({
            mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
            url: 'http://192.168.1.20/server/load.php',
        });

        expect(outcome.kind).toBe('success');
        if (outcome.kind !== 'success') {
            throw new Error('Expected transport success');
        }
        expect(Array.from(outcome.result.body)).toEqual([0xc3, 0x28]);
        expect(() =>
            new TextDecoder('utf-8', { fatal: true }).decode(
                outcome.result.body
            )
        ).toThrow();
    });
});
