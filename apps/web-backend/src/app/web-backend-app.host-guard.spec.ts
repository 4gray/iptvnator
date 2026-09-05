/**
 * Per-host circuit breaker behaviour on the proxy routes.
 *
 * The rules themselves are covered by the guard's own spec in
 * `@iptvnator/shared/host-health`; what matters here is the wiring: which
 * routes consult it, what a refusal looks like on the wire, and that a refusal
 * really does skip the outbound request.
 */

import {
    HostConnectivityGuard,
    OPEN_DURATION_MS,
} from '@iptvnator/shared/host-health';
import { isHostConnectivityFastFailMessage } from '@iptvnator/shared/interfaces';
import { createWebBackendApp } from './web-backend-app';
import express, { Response } from 'express';
import {
    registerProviderTarget,
    resolvePublicHost,
    StubHttpClient,
    withServer,
} from './web-backend-app.spec-helpers';

/** A refusal the guard counts: the host itself never answered. */
function hostLevelFailure(code = 'ECONNREFUSED'): Error {
    return Object.assign(new Error(`connect ${code}`), { code });
}

/** Guard driven by a clock the test owns, so no timers are involved. */
function createTestGuard(): {
    guard: HostConnectivityGuard;
    advance: (ms: number) => void;
} {
    let clock = 1_000;
    return {
        guard: new HostConnectivityGuard({ now: () => clock }),
        advance: (ms: number) => {
            clock += ms;
        },
    };
}

describe('web backend host connectivity guard', () => {
    it('fast-fails Xtream requests with HTTP 200 and the provider-error body once the host stops answering', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueNetworkError(hostLevelFailure());
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&password=secret&action=get_account_info`
                    );

                await call();
                await call();
                const refused = await call();

                // The route answers provider failures with HTTP 200 and an
                // error body; PwaService parses that shape, so a fast-fail
                // must not suddenly become a real HTTP error status.
                expect(refused.status).toBe(200);
                const body = (await refused.json()) as {
                    message: string;
                    status: number;
                };
                expect(body.status).toBe(502);
                expect(isHostConnectivityFastFailMessage(body.message)).toBe(
                    true
                );
                // Names the host so the snackbar it reaches says something
                // useful, and never the credential-bearing query string.
                expect(body.message).toContain('xtream.example');
                expect(body.message).not.toContain('secret');

                // The whole point: the third call never went out.
                expect(httpClient.requests).toHaveLength(2);
            }
        );
    });

    it('fast-fails Stalker requests with HTTP 200 and a message carrying no HTTP status', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure('ETIMEDOUT'));
        httpClient.queueNetworkError(hostLevelFailure('ETIMEDOUT'));
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://stalker.example/portal.php'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&action=get_categories&type=vod`
                    );

                await call();
                await call();
                const refused = await call();

                expect(refused.status).toBe(200);
                const body = (await refused.json()) as {
                    message: string;
                    status: number;
                };
                expect(isHostConnectivityFastFailMessage(body.message)).toBe(
                    true
                );
                // The renderer classifies Stalker transport failures from the
                // message alone. An `HTTP Error <code>` in it would read as
                // "the endpoint answered" and make discovery walk every
                // remaining candidate; timeout wording would do the same.
                expect(body.message).not.toMatch(/HTTP Error \d{3}/);
                expect(body.message).not.toMatch(/timed out|timeout of \d+/i);
                expect(httpClient.requests).toHaveLength(2);
            }
        );
    });

    it('exempts endpoint-discovery probes from the breaker but still credits their successes', async () => {
        // Discovery walks several candidate paths on one host and expects most
        // to fail. Counting those would declare a slow-but-alive portal
        // unreachable, and fast-failing them would abandon a portal
        // mid-discovery — the candidate that works may be the last one tried.
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure('ETIMEDOUT'));
        httpClient.queueNetworkError(hostLevelFailure('ETIMEDOUT'));
        httpClient.queueResponse({ js: [{ id: '1' }] });
        httpClient.queueResponse({ js: [{ id: '2' }] });
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://stalker.example/portal.php'
                );
                const probe = () =>
                    fetch(
                        `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&action=get_genres&skipConnectionGuard=true`
                    );

                await probe();
                await probe();
                const third = await probe();

                // Two probe failures must not have opened the breaker.
                await expect(third.json()).resolves.toEqual({
                    action: 'get_genres',
                    payload: { js: [{ id: '1' }] },
                });
                expect(httpClient.requests).toHaveLength(3);

                // The exemption is bypass-and-don't-count, not
                // don't-report-at-all: a candidate that answers still clears
                // whatever the other candidates recorded.
                const normal = await fetch(
                    `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01&action=get_categories`
                );
                await expect(normal.json()).resolves.toEqual({
                    action: 'get_categories',
                    payload: { js: [{ id: '2' }] },
                });
                expect(httpClient.requests).toHaveLength(4);

                // And the flag is a control param: it must never be forwarded
                // into the portal's own query string.
                for (const request of httpClient.requests) {
                    expect(request.url).not.toContain('skipConnectionGuard');
                }
            }
        );
    });

    it('lets an exempt probe clear the record with a response it was rejected for', async () => {
        // This route sets no `validateStatus`, so axios rejects EVERY non-2xx
        // with `error.response` attached. A discovery probe answered with 500
        // has still proved the endpoint alive, so the report has to happen even
        // though the probe's own failures are not counted — dropping it is what
        // lets the breaker open in the middle of discovery.
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure('ETIMEDOUT'));
        httpClient.queueFailure(500, 'Internal Server Error');
        httpClient.queueNetworkError(hostLevelFailure('ETIMEDOUT'));
        httpClient.queueResponse({ js: [{ id: '1' }] });
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://stalker.example/portal.php'
                );
                const base = `${baseUrl}/stalker?targetId=${targetId}&macAddress=00:1A:79:00:00:01`;

                // Counted failure, then an exempt probe answered with 500, then
                // another counted failure. Without the probe's report the two
                // counted failures are consecutive and open the breaker.
                await fetch(`${base}&action=get_categories`);
                await fetch(
                    `${base}&action=get_genres&skipConnectionGuard=true`
                );
                await fetch(`${base}&action=get_categories`);

                const afterwards = await fetch(`${base}&action=get_categories`);

                await expect(afterwards.json()).resolves.toEqual({
                    action: 'get_categories',
                    payload: { js: [{ id: '1' }] },
                });
                expect(httpClient.requests).toHaveLength(4);
            }
        );
    });

    it('never fast-fails playlist or EPG downloads, however often they fail', async () => {
        // The breaker covers the portal routes only, matching Electron, where
        // it is wired into the two portal IPC handlers and not into the
        // playlist or EPG download path. Guarding these was a mistake caught in
        // review: a download is one request rather than a catalog fan-out, it
        // is usually the direct result of the user asking for it — so refusing
        // an immediate retry of an M3U import is a regression, not a
        // protection — and a large XMLTV transfer can legitimately outlive the
        // half-open trial window, which would let a second trial in behind it.
        const httpClient = new StubHttpClient();
        for (let i = 0; i < 4; i++) {
            httpClient.queueNetworkError(hostLevelFailure());
        }
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const playlistTarget = await registerProviderTarget(
                    baseUrl,
                    'https://provider.example/list.m3u'
                );
                const epgTarget = await registerProviderTarget(
                    baseUrl,
                    'https://provider.example/guide.xml'
                );

                for (let i = 0; i < 3; i++) {
                    await fetch(`${baseUrl}/parse?targetId=${playlistTarget}`);
                }
                const epg = await fetch(
                    `${baseUrl}/parse-xml?targetId=${epgTarget}`
                );

                // Every one of them reached the host: no admission check, and
                // nothing recorded against it either.
                expect(httpClient.requests).toHaveLength(4);
                const body = (await epg.json()) as { message: string };
                expect(isHostConnectivityFastFailMessage(body.message)).toBe(
                    false
                );
            }
        );
    });

    it('keeps talking to a host that answers, whatever the status says', async () => {
        const httpClient = new StubHttpClient();
        // A 404 is an answer: the host is alive and the record must clear.
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueFailure(404, 'Not Found');
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueResponse({ user_info: { username: 'demo' } });
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&action=get_account_info`
                    );

                await call();
                await call();
                await call();
                const answered = await call();

                await expect(answered.json()).resolves.toEqual({
                    action: 'get_account_info',
                    payload: { user_info: { username: 'demo' } },
                });
                expect(httpClient.requests).toHaveLength(4);
            }
        );
    });

    it('fast-fails an open host before spending a DNS lookup on it', async () => {
        // URL validation resolves the hostname, and a dead host is exactly
        // where DNS is slow or failing too. Checking the breaker after that
        // meant an open host still paid for a lookup and could answer "host
        // could not be resolved" instead of the intended fast-fail.
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueNetworkError(hostLevelFailure());
        const { guard } = createTestGuard();
        const resolveHostname = jest
            .fn<Promise<readonly string[]>, [string]>()
            .mockResolvedValue(['93.184.216.34']);

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&action=get_account_info`
                    );

                await call();
                await call();
                const lookupsBeforeRefusal = resolveHostname.mock.calls.length;

                const refused = await call();

                expect(refused.status).toBe(200);
                const body = (await refused.json()) as { message: string };
                expect(isHostConnectivityFastFailMessage(body.message)).toBe(
                    true
                );
                expect(resolveHostname).toHaveBeenCalledTimes(
                    lookupsBeforeRefusal
                );
            }
        );
    });

    it('returns the half-open slot when a URL policy refusal aborts the request', async () => {
        // Admitted, then abandoned before anything went out. That is not
        // evidence about the host, but the trial slot has to go back or the
        // breaker waits out the full trial window for a request that never
        // happened.
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueResponse({ user_info: { username: 'demo' } });
        const { advance, guard } = createTestGuard();
        let resolvable = true;
        const resolveHostname = async () => {
            if (!resolvable) {
                throw new Error('EAI_AGAIN');
            }
            return ['93.184.216.34'];
        };

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&action=get_account_info`
                    );

                await call();
                await call();
                advance(OPEN_DURATION_MS + 1);

                // Half-open. This trial is abandoned by the policy, so it must
                // not consume the single trial the breaker allows.
                resolvable = false;
                const refusedByPolicy = await call();
                expect(refusedByPolicy.status).toBe(400);

                resolvable = true;
                const trial = await call();
                await expect(trial.json()).resolves.toEqual({
                    action: 'get_account_info',
                    payload: { user_info: { username: 'demo' } },
                });
                expect(httpClient.requests).toHaveLength(3);
            }
        );
    });

    it('counts a hostname that stops resolving, and never leaks the lookup error', async () => {
        // A name that will not resolve is the host failing to answer, the same
        // as the ENOTFOUND the transport would have raised a moment later.
        // Releasing it as a policy refusal left the breaker permanently shut
        // and every request paying for the same dead lookup.
        const httpClient = new StubHttpClient();
        const { guard } = createTestGuard();
        let resolvable = true;
        const resolveHostname = async () => {
            if (!resolvable) {
                throw Object.assign(new Error('getaddrinfo ENOTFOUND'), {
                    code: 'ENOTFOUND',
                });
            }
            return ['93.184.216.34'];
        };

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname,
            }),
            async (baseUrl) => {
                // Registering the target resolves the name too, so do it while
                // DNS still answers — then let the name die.
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                resolvable = false;

                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&action=get_account_info`
                    );

                const first = await call();
                expect(first.status).toBe(400);
                // The DNS error is internal: the client sees what it always saw.
                await expect(first.json()).resolves.toEqual({
                    message: 'Provider URL host could not be resolved',
                    status: 400,
                });

                await call();
                const refused = await call();

                // Two counted lookup failures opened the breaker, so the third
                // is refused outright instead of resolving again.
                expect(refused.status).toBe(200);
                const body = (await refused.json()) as { message: string };
                expect(isHostConnectivityFastFailMessage(body.message)).toBe(
                    true
                );
                expect(httpClient.requests).toHaveLength(0);
            }
        );
    });

    it('does not fast-fail a provider whose redirect destination is dead', async () => {
        // The shape this route actually produces, verified against axios
        // 1.19.0: follow-redirects walks the chain inside one `get()`, so
        // `config` still holds the URL we asked for and only
        // `request._currentUrl` names the hop that failed. Reading `config.url`
        // alone would compare the original URL with itself, find no redirect,
        // and charge the dead destination to the provider that answered.
        const redirectedFailure = () =>
            Object.assign(new Error('connect ECONNREFUSED'), {
                code: 'ECONNREFUSED',
                config: { url: 'http://xtream.example/player_api.php' },
                request: { _currentUrl: 'http://cdn.dead.example/stream' },
            });
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(redirectedFailure());
        httpClient.queueNetworkError(redirectedFailure());
        httpClient.queueResponse({ user_info: { username: 'demo' } });
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&action=get_account_info`
                    );

                await call();
                await call();
                const third = await call();

                await expect(third.json()).resolves.toEqual({
                    action: 'get_account_info',
                    payload: { user_info: { username: 'demo' } },
                });
                expect(httpClient.requests).toHaveLength(3);
            }
        );
    });

    it('keeps ownership through a real axios redirect and unfinished streaming body', async () => {
        const provider = express();
        let stream!: Response;
        let arrived!: () => void;
        const started = new Promise<void>((resolve) => {
            arrived = resolve;
        });
        provider.get('/player_api.php', (_req, res) => res.redirect('/body'));
        provider.get('/body', (_req, res) => {
            if (stream) {
                res.json({ duplicate: true });
                return;
            }
            stream = res;
            res.type('json').write('{"items":[');
            arrived();
        });
        const { guard, advance } = createTestGuard();
        await withServer(provider, async (providerUrl) => {
            for (let attempt = 0; attempt < 2; attempt++) {
                const admission = guard.check(providerUrl);
                if (!admission.allowed)
                    throw new Error('Expected initial admission');
                guard.reportFailure(admission.token);
            }
            advance(OPEN_DURATION_MS + 1);
            await withServer(
                createWebBackendApp({
                    hostGuard: guard,
                    allowPrivateNetworkTargets: true,
                }),
                async (baseUrl) => {
                    const targetId = await registerProviderTarget(
                        baseUrl,
                        providerUrl
                    );
                    const call = () =>
                        fetch(`${baseUrl}/xtream?targetId=${targetId}`);
                    const trial = call();
                    try {
                        await started;
                        advance(25_000);
                        stream.write('1,');
                        advance(25_000);
                        const response = await call();
                        const body = (await response.json()) as {
                            message: string;
                        };
                        expect(
                            isHostConnectivityFastFailMessage(body.message)
                        ).toBe(true);
                    } finally {
                        stream?.end('2]}');
                        await trial;
                    }
                    await expect((await trial).json()).resolves.toMatchObject({
                        payload: { items: [1, 2] },
                    });
                    expect(guard.check(providerUrl)).toMatchObject({
                        allowed: true,
                        token: { trial: false },
                    });
                }
            );
        });
    });

    it.each(['xtream', 'stalker'])(
        '%s releases its trial if outcome reporting throws',
        async (route) => {
            const httpClient = new StubHttpClient();
            const { advance, guard } = createTestGuard();
            httpClient.queueNetworkError(hostLevelFailure());
            httpClient.queueNetworkError(hostLevelFailure());
            httpClient.queueNetworkError(hostLevelFailure());
            httpClient.queueResponse([]);
            await withServer(
                createWebBackendApp({
                    hostGuard: guard,
                    httpClient,
                    resolveHostname: resolvePublicHost,
                }),
                async (baseUrl) => {
                    const targetId = await registerProviderTarget(
                        baseUrl,
                        'http://portal.example'
                    );
                    const call = () =>
                        fetch(`${baseUrl}/${route}?targetId=${targetId}`);
                    await call();
                    await call();
                    advance(OPEN_DURATION_MS + 1);
                    const report = jest
                        .spyOn(guard, 'reportFailure')
                        .mockImplementationOnce(() => {
                            throw new Error('outcome reporting failed');
                        });
                    try {
                        expect((await call()).status).toBe(500);
                    } finally {
                        report.mockRestore();
                    }
                    await expect((await call()).json()).resolves.toMatchObject({
                        payload: [],
                    });
                    expect(httpClient.requests).toHaveLength(4);
                }
            );
        }
    );

    it.each(['xtream', 'stalker'])(
        '%s holds a live trial beyond 45 seconds until the transport settles',
        async (route) => {
            for (const outcome of [
                'success',
                'failure',
                'cancel',
                'redirect-failure',
            ]) {
                const httpClient = new StubHttpClient();
                const { advance, guard } = createTestGuard();
                httpClient.queueNetworkError(hostLevelFailure());
                httpClient.queueNetworkError(hostLevelFailure());
                await withServer(
                    createWebBackendApp({
                        hostGuard: guard,
                        httpClient,
                        resolveHostname: resolvePublicHost,
                    }),
                    async (baseUrl) => {
                        const targetId = await registerProviderTarget(
                            baseUrl,
                            'http://portal.example'
                        );
                        const call = () =>
                            fetch(
                                `${baseUrl}/${route}?targetId=${targetId}&action=get_genres`
                            );
                        await call();
                        await call();
                        advance(OPEN_DURATION_MS + 1);
                        let settle!: () => void;
                        let arrived!: () => void;
                        const pending = new Promise<void>((resolve) => {
                            settle = resolve;
                        });
                        const started = new Promise<void>((resolve) => {
                            arrived = resolve;
                        });
                        const transport = jest
                            .spyOn(httpClient, 'get')
                            .mockImplementationOnce(async () => {
                                arrived();
                                await pending;
                                if (outcome !== 'success') {
                                    throw Object.assign(
                                        hostLevelFailure(
                                            outcome === 'cancel'
                                                ? 'ERR_CANCELED'
                                                : 'ETIMEDOUT'
                                        ),
                                        {
                                            request: {
                                                _currentUrl:
                                                    outcome ===
                                                    'redirect-failure'
                                                        ? 'http://cdn.example/slow'
                                                        : `http://portal.example/${route === 'xtream' ? 'player_api.php' : ''}`,
                                            },
                                        }
                                    );
                                }
                                return { data: [] as never };
                            });
                        const trial = call();
                        try {
                            await started;
                            // Advance only the guard clock; the HTTP route remains genuinely pending.
                            advance(45_001);
                            const blocked = await call();
                            expect(
                                isHostConnectivityFastFailMessage(
                                    (
                                        (await blocked.json()) as {
                                            message: string;
                                        }
                                    ).message
                                )
                            ).toBe(true);
                            expect(transport).toHaveBeenCalledTimes(1);
                        } finally {
                            settle();
                            await trial;
                            transport.mockRestore();
                        }
                        if (outcome === 'failure') {
                            const blocked = await call();
                            expect(
                                isHostConnectivityFastFailMessage(
                                    (
                                        (await blocked.json()) as {
                                            message: string;
                                        }
                                    ).message
                                )
                            ).toBe(true);
                            advance(OPEN_DURATION_MS + 1);
                        }
                        httpClient.queueResponse([]);
                        await expect(
                            (await call()).json()
                        ).resolves.toMatchObject({ payload: [] });
                        expect(httpClient.requests).toHaveLength(3);
                    }
                );
            }
        }
    );

    it('lets exactly one request through once the open window elapses', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueResponse({ user_info: { username: 'demo' } });
        const { advance, guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&action=get_account_info`
                    );

                await call();
                await call();
                await call();
                expect(httpClient.requests).toHaveLength(2);

                advance(OPEN_DURATION_MS + 1);
                const trial = await call();

                await expect(trial.json()).resolves.toEqual({
                    action: 'get_account_info',
                    payload: { user_info: { username: 'demo' } },
                });
                expect(httpClient.requests).toHaveLength(3);
            }
        );
    });

    it('contacts the host for real again after an explicit reset', async () => {
        const httpClient = new StubHttpClient();
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueNetworkError(hostLevelFailure());
        httpClient.queueResponse({ user_info: { username: 'demo' } });
        const { guard } = createTestGuard();

        await withServer(
            createWebBackendApp({
                hostGuard: guard,
                httpClient,
                resolveHostname: resolvePublicHost,
            }),
            async (baseUrl) => {
                const targetId = await registerProviderTarget(
                    baseUrl,
                    'http://xtream.example'
                );
                const call = () =>
                    fetch(
                        `${baseUrl}/xtream?targetId=${targetId}&username=demo&action=get_account_info`
                    );

                await call();
                await call();
                await call();
                expect(httpClient.requests).toHaveLength(2);

                const reset = await fetch(
                    `${baseUrl}/connectivity-guard/reset`,
                    {
                        body: JSON.stringify({
                            url: 'http://xtream.example/player_api.php',
                        }),
                        headers: { 'content-type': 'application/json' },
                        method: 'POST',
                    }
                );
                await expect(reset.json()).resolves.toEqual({ reset: true });

                const retried = await call();
                await expect(retried.json()).resolves.toEqual({
                    action: 'get_account_info',
                    payload: { user_info: { username: 'demo' } },
                });
                expect(httpClient.requests).toHaveLength(3);
            }
        );
    });

    it('rejects a reset without a url and reports one it cannot read a host from', async () => {
        await withServer(
            createWebBackendApp({ resolveHostname: resolvePublicHost }),
            async (baseUrl) => {
                const post = (body: unknown) =>
                    fetch(`${baseUrl}/connectivity-guard/reset`, {
                        body: JSON.stringify(body),
                        headers: { 'content-type': 'application/json' },
                        method: 'POST',
                    });

                const missing = await post({});
                expect(missing.status).toBe(400);

                const unusable = await post({ url: 'not a url' });
                expect(unusable.status).toBe(200);
                await expect(unusable.json()).resolves.toEqual({
                    reset: false,
                });
            }
        );
    });
});
