import {
    STALKER_HTTP_OUTCOME_KINDS,
    STALKER_HTTP_REQUEST_MODES,
    type StalkerHttpRequest,
    type StalkerHttpRequestOutcome,
} from './stalker-http-session';
import { StalkerCookieJar } from './stalker-cookie-jar';
import {
    StalkerEndpointResolver,
    type StalkerEndpointResolverDependencies,
} from './stalker-endpoint-resolver';
import type { StalkerSessionConnectionDescriptor } from '@iptvnator/shared/interfaces';

const transport = {
    maxResponseBytes: 1024 * 1024,
    timeoutMs: 5000,
};

function descriptor(
    overrides: Partial<StalkerSessionConnectionDescriptor> = {}
): StalkerSessionConnectionDescriptor {
    return {
        connectionMode: 'persisted-open',
        playlistRef: 'playlist-1',
        sourceUrl: 'https://portal.test/c/',
        macAddress: '00:1A:79:AA:BB:CC',
        profilePreset: {
            id: 'mag250-public-5_1-minimal-v1',
            version: 1,
        },
        ...overrides,
    } as StalkerSessionConnectionDescriptor;
}

function success(
    value: unknown,
    options: {
        contentType?: string;
        finalUrl?: string;
        status?: number;
    } = {}
): StalkerHttpRequestOutcome {
    return {
        kind: STALKER_HTTP_OUTCOME_KINDS.Success,
        result: {
            body: new TextEncoder().encode(JSON.stringify(value)),
            contentType: options.contentType ?? 'application/json',
            finalUrl: options.finalUrl ?? 'https://portal.test/c/',
            status: options.status ?? 200,
        },
    };
}

function rawSuccess(
    body: string,
    options: {
        contentType?: string;
        finalUrl?: string;
        status?: number;
    } = {}
): StalkerHttpRequestOutcome {
    return {
        kind: STALKER_HTTP_OUTCOME_KINDS.Success,
        result: {
            body: new TextEncoder().encode(body),
            contentType: options.contentType ?? 'application/json',
            finalUrl: options.finalUrl ?? 'https://portal.test/c/',
            status: options.status ?? 200,
        },
    };
}

function createHarness(
    responder: (
        request: StalkerHttpRequest,
        jar: StalkerCookieJar
    ) => Promise<StalkerHttpRequestOutcome> | StalkerHttpRequestOutcome
) {
    const calls: StalkerHttpRequest[] = [];
    const jars: StalkerCookieJar[] = [];
    const dependencies: StalkerEndpointResolverDependencies = {
        createHttpSession: (jar) => {
            jars.push(jar);
            return {
                request: async (request) => {
                    calls.push(request);
                    return responder(request, jar);
                },
            };
        },
        createCookieJar: () => new StalkerCookieJar(),
    };
    return {
        calls,
        jars,
        resolver: new StalkerEndpointResolver(dependencies),
    };
}

describe('StalkerEndpointResolver', () => {
    it('keeps landing anonymous and requires approval before cross-origin identity', async () => {
        const harness = createHarness((request) => {
            expect(request.mode).toBe(STALKER_HTTP_REQUEST_MODES.Anonymous);
            return success(
                {},
                {
                    finalUrl: 'https://edge.portal.test/customer/c/',
                }
            );
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome).toEqual({
            finalOrigin: 'https://edge.portal.test',
            kind: 'origin-approval-required',
            landingUrl: 'https://edge.portal.test/customer/c/',
            sourceOrigin: 'https://portal.test',
        });
        expect(harness.calls).toHaveLength(1);
        expect(harness.calls[0]).toEqual({
            mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
            url: 'https://portal.test/c/',
        });
    });

    it('promotes the winning handshake, first profile, and candidate jar without repeating requests', async () => {
        const harness = createHarness(async (request, jar) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                await jar.collectResponseCookies(request.url, [
                    'landing=retained; Path=/',
                ]);
                return success({}, { finalUrl: request.url });
            }
            if (action === 'handshake') {
                return success(
                    { js: { token: 'token-one', random: 'random-one' } },
                    { finalUrl: request.url }
                );
            }
            if (action === 'get_profile') {
                return success(
                    { js: { id: 'profile-one', status: 0 } },
                    { finalUrl: request.url }
                );
            }
            throw new Error(`Unexpected action: ${String(action)}`);
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome.kind).toBe('full-session');
        if (outcome.kind !== 'full-session') {
            throw new Error('Expected full session');
        }
        expect(outcome).toMatchObject({
            endpoint: 'https://portal.test/server/load.php',
            handshakeRandom: 'random-one',
            landingUrl: 'https://portal.test/c/',
            profile: {
                kind: 'ready',
                status: 0,
            },
            token: 'token-one',
        });
        expect(
            await outcome.cookieJar.getCookieHeader(outcome.endpoint)
        ).toContain('landing=retained');
        expect(
            await outcome.cookieJar.getCookieHeader(outcome.endpoint)
        ).toContain('mac=00:1A:79:AA:BB:CC');
        expect(
            harness.calls.filter(
                (request) => request.params?.['action'] === 'handshake'
            )
        ).toHaveLength(1);
        const handshakeRequest = harness.calls.find(
            (request) => request.params?.['action'] === 'handshake'
        );
        expect(handshakeRequest?.params).not.toHaveProperty('token');
        const profileRequest = harness.calls.find(
            (request) => request.params?.['action'] === 'get_profile'
        );
        expect(profileRequest?.params?.['auth_second_step']).toBe(0);
        expect(
            (profileRequest as { headers?: Record<string, string> }).headers
                ?.Authorization
        ).toBe('Bearer token-one');
    });

    it('stops at the first profile with an unknown status', async () => {
        const harness = createHarness((request) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (action === 'handshake') {
                return success(
                    { js: { token: 'candidate-token' } },
                    { finalUrl: request.url }
                );
            }
            if (action === 'get_profile') {
                return success(
                    { js: { id: 'profile-one', status: 3 } },
                    { finalUrl: request.url }
                );
            }
            throw new Error(`Unexpected action: ${String(action)}`);
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
            retryable: false,
            stage: 'resolving',
        });
        expect(
            harness.calls.filter(
                (request) => request.params?.['action'] === 'handshake'
            )
        ).toHaveLength(1);
        expect(
            harness.calls.filter(
                (request) => request.params?.['action'] === 'get_profile'
            )
        ).toHaveLength(1);
        expect(
            harness.calls.some(
                (request) => request.params?.['action'] === 'get_genres'
            )
        ).toBe(false);
    });

    it.each([
        ['a handshake token near miss', () => success({ js: { token: 1 } })],
        [
            'malformed JSONP',
            () =>
                rawSuccess('callback({"js":{"token":"candidate-token"}}', {
                    contentType: 'application/javascript',
                }),
        ],
        [
            'JSON with the wrong content type',
            () =>
                rawSuccess('{"js":{"token":"candidate-token"}}', {
                    contentType: 'text/html',
                }),
        ],
    ])(
        'treats %s as terminal and never advances candidates',
        async (_, reply) => {
            const harness = createHarness((request) => {
                if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                    return success({}, { finalUrl: request.url });
                }
                return reply();
            });

            const outcome = await harness.resolver.resolve({
                descriptor: descriptor(),
                transport,
            });

            expect(outcome).toEqual({
                kind: 'failure',
                reason: 'incompatible-response',
                retryable: false,
                stage: 'resolving',
            });
            expect(
                harness.calls.filter(
                    (request) => request.params?.['action'] === 'handshake'
                )
            ).toHaveLength(1);
            expect(
                harness.calls.some(
                    (request) => request.params?.['action'] === 'get_genres'
                )
            ).toBe(false);
        }
    );

    it('skips a learned endpoint whose valid API JSON has the wrong content type', async () => {
        const handshakeUrls: string[] = [];
        const harness = createHarness((request) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (action === 'handshake') {
                handshakeUrls.push(request.url);
            }
            if (request.url.includes('/learned/')) {
                return rawSuccess(
                    '{"js":{"token":"stale-learned-token"}}',
                    {
                        contentType: 'text/html',
                        finalUrl: request.url,
                    }
                );
            }
            if (action === 'handshake') {
                return success(
                    { js: { token: 'rediscovered-token' } },
                    { finalUrl: request.url }
                );
            }
            return success(
                { js: { status: 0 } },
                { finalUrl: request.url }
            );
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor({
                learnedEndpointHint:
                    'https://portal.test/learned/server/load.php',
            }),
            transport,
        });

        expect(outcome).toMatchObject({
            endpoint: 'https://portal.test/server/load.php',
            kind: 'full-session',
        });
        expect(handshakeUrls).toEqual([
            'https://portal.test/learned/server/load.php',
            'https://portal.test/server/load.php',
        ]);
    });

    it('rejects a stateless catalog near miss without advancing candidates', async () => {
        const harness = createHarness((request) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (action === 'handshake') {
                return success({}, { finalUrl: request.url, status: 404 });
            }
            if (action === 'get_genres') {
                return success(
                    { js: { id: 'not-a-catalog' } },
                    { finalUrl: request.url }
                );
            }
            throw new Error(`Unexpected action: ${String(action)}`);
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome).toEqual({
            kind: 'failure',
            reason: 'incompatible-response',
            retryable: false,
            stage: 'resolving',
        });
        expect(
            harness.calls.filter(
                (request) => request.params?.['action'] === 'handshake'
            )
        ).toHaveLength(1);
        expect(
            harness.calls.filter(
                (request) => request.params?.['action'] === 'get_genres'
            )
        ).toHaveLength(1);
    });

    it('advances after a benign HTML endpoint-shape miss and promotes the next valid endpoint', async () => {
        const harness = createHarness((request) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (
                request.url.endsWith('/server/load.php') &&
                action === 'handshake'
            ) {
                return rawSuccess(
                    [
                        '<!doctype html><html><head>',
                        '<title>stalker_portal</title>',
                        '<script src="../server/api/load_js.php"></script>',
                        '</head><body></body></html>',
                    ].join(''),
                    {
                        contentType: 'text/html; charset=utf-8',
                        finalUrl: request.url,
                    }
                );
            }
            if (action === 'handshake') {
                return success(
                    { js: { token: 'html-fallback-token' } },
                    { finalUrl: request.url }
                );
            }
            if (action === 'get_profile') {
                return success(
                    { js: { status: 0 } },
                    { finalUrl: request.url }
                );
            }
            throw new Error('Unexpected request');
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome).toMatchObject({
            endpoint: 'https://portal.test/portal.php',
            kind: 'full-session',
        });
        expect(
            harness.calls.filter(
                (request) => request.params?.['action'] === 'handshake'
            )
        ).toHaveLength(2);
        expect(
            harness.calls.some(
                (request) => request.params?.['action'] === 'get_genres'
            )
        ).toBe(false);
    });

    it.each([
        [
            'an unknown HTML account denial',
            '<!doctype html><html><body>Account suspended</body></html>',
            'text/html',
        ],
        [
            'an unknown XHTML device denial',
            '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>Device blocked</body></html>',
            'application/xhtml+xml',
        ],
        [
            'an HTML denial with only a portal title marker',
            '<!doctype html><html><head><title>stalker_portal</title></head><body>Account suspended</body></html>',
            'text/html',
        ],
    ])(
        'treats %s as terminal after earlier stateless evidence',
        async (_, denialBody, contentType) => {
            const harness = createHarness((request) => {
                const action = request.params?.['action'];
                if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                    return success({}, { finalUrl: request.url });
                }
                if (
                    request.url.endsWith('/server/load.php') &&
                    action === 'handshake'
                ) {
                    return success(
                        {},
                        { finalUrl: request.url, status: 404 }
                    );
                }
                if (
                    request.url.endsWith('/server/load.php') &&
                    action === 'get_genres'
                ) {
                    return success(
                        { js: [{ id: '*', title: 'All' }] },
                        { finalUrl: request.url }
                    );
                }
                if (
                    request.url.endsWith('/portal.php') &&
                    action === 'handshake'
                ) {
                    return rawSuccess(denialBody, {
                        contentType,
                        finalUrl: request.url,
                    });
                }
                throw new Error('Unexpected request');
            });

            const outcome = await harness.resolver.resolve({
                descriptor: descriptor(),
                transport,
            });

            expect(outcome).toEqual({
                kind: 'failure',
                reason: 'incompatible-response',
                retryable: false,
                stage: 'resolving',
            });
        }
    );

    it('continues after early stateless evidence so a later full endpoint wins', async () => {
        const harness = createHarness((request) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (
                request.url.endsWith('/server/load.php') &&
                action === 'handshake'
            ) {
                return success({}, { finalUrl: request.url, status: 404 });
            }
            if (
                request.url.endsWith('/server/load.php') &&
                action === 'get_genres'
            ) {
                return success(
                    { js: [{ id: '*', title: 'All' }] },
                    { finalUrl: request.url }
                );
            }
            if (action === 'handshake') {
                return success(
                    { js: { token: 'later-token' } },
                    { finalUrl: request.url }
                );
            }
            if (action === 'get_profile') {
                return success(
                    { js: { status: 2 } },
                    { finalUrl: request.url }
                );
            }
            throw new Error('Unexpected request');
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome).toMatchObject({
            endpoint: 'https://portal.test/portal.php',
            kind: 'full-session',
            profile: { kind: 'credentials-required', status: 2 },
        });
    });

    it('forbids stateless downgrade after protection, rate-limit, or transport failure', async () => {
        const harness = createHarness((request) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (
                request.url.endsWith('/server/load.php') &&
                action === 'handshake'
            ) {
                return success({}, { finalUrl: request.url, status: 404 });
            }
            if (
                request.url.endsWith('/server/load.php') &&
                action === 'get_genres'
            ) {
                return success(
                    { js: [{ id: '1' }] },
                    { finalUrl: request.url }
                );
            }
            return {
                kind: STALKER_HTTP_OUTCOME_KINDS.Failure,
                reason: 'rate-limited',
                retryable: true,
            };
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome).toEqual({
            kind: 'failure',
            reason: 'rate-limited',
            retryable: true,
            stage: 'resolving',
        });
    });

    it('isolates failed candidate cookie mutations from later candidates', async () => {
        let secondCandidateCookie = '';
        const harness = createHarness(async (request, jar) => {
            const action = request.params?.['action'];
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (
                request.url.endsWith('/server/load.php') &&
                action === 'handshake'
            ) {
                await jar.collectResponseCookies(request.url, [
                    'poison=first; Path=/',
                ]);
                return success({}, { finalUrl: request.url, status: 404 });
            }
            if (request.url.endsWith('/portal.php') && action === 'handshake') {
                secondCandidateCookie =
                    (await jar.getCookieHeader(request.url)) ?? '';
                return success(
                    { js: { token: 'clean-token' } },
                    { finalUrl: request.url }
                );
            }
            if (action === 'get_profile') {
                return success(
                    { js: { status: 0 } },
                    { finalUrl: request.url }
                );
            }
            return success({}, { finalUrl: request.url, status: 404 });
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor(),
            transport,
        });

        expect(outcome.kind).toBe('full-session');
        expect(secondCandidateCookie).not.toContain('poison=first');
    });

    it.each([404, 405, 501])(
        'keeps explicit unsupported HTTP %i eligible for candidate rediscovery',
        async (unsupportedStatus) => {
            const handshakeUrls: string[] = [];
            const harness = createHarness((request) => {
                const action = request.params?.['action'];
                if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                    return success({}, { finalUrl: request.url });
                }
                if (action === 'handshake') {
                    handshakeUrls.push(request.url);
                }
                if (request.url.includes('/learned/')) {
                    return unsupportedStatus === 404
                        ? rawSuccess('<html><body>Not found</body></html>', {
                              contentType: 'text/html',
                              finalUrl: request.url,
                              status: unsupportedStatus,
                          })
                        : success(
                              {},
                              {
                                  finalUrl: request.url,
                                  status: unsupportedStatus,
                              }
                          );
                }
                if (action === 'handshake') {
                    return success(
                        { js: { token: 'rediscovered-token' } },
                        { finalUrl: request.url }
                    );
                }
                return success(
                    { js: { status: 0 } },
                    { finalUrl: request.url }
                );
            });

            const outcome = await harness.resolver.resolve({
                descriptor: descriptor({
                    learnedEndpointHint:
                        'https://portal.test/learned/server/load.php',
                }),
                transport,
            });

            expect(outcome.kind).toBe('full-session');
            expect(handshakeUrls).toEqual([
                'https://portal.test/learned/server/load.php',
                'https://portal.test/server/load.php',
            ]);
        }
    );

    it('ignores an unapproved cross-origin learned endpoint before sending identity', async () => {
        const harness = createHarness((request) => {
            if (request.mode === STALKER_HTTP_REQUEST_MODES.Anonymous) {
                return success({}, { finalUrl: request.url });
            }
            if (request.params?.['action'] === 'handshake') {
                return success(
                    { js: { token: 'same-origin-token' } },
                    { finalUrl: request.url }
                );
            }
            return success({ js: { status: 0 } }, { finalUrl: request.url });
        });

        const outcome = await harness.resolver.resolve({
            descriptor: descriptor({
                learnedEndpointHint:
                    'https://unapproved.example/server/load.php',
            }),
            transport,
        });

        expect(outcome).toMatchObject({
            endpoint: 'https://portal.test/server/load.php',
            kind: 'full-session',
        });
        expect(
            harness.calls
                .filter(
                    (request) =>
                        request.mode ===
                        STALKER_HTTP_REQUEST_MODES.IdentityBearing
                )
                .map((request) => request.url)
        ).not.toContain('https://unapproved.example/server/load.php');
    });
});
