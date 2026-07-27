/* eslint-disable max-lines, @typescript-eslint/no-non-null-assertion -- Network contract scenarios stay explicit so every synthetic origin and wire value is auditable. */
import http from 'node:http';
import {
    createReplayServerRun,
    ReplayServerRun,
} from './replay-server.js';
import { REPLAY_MAX_REQUEST_BODY_BYTES } from './replay.constants.js';
import {
    ReplayExpectation,
    ReplayFixtureV1,
    ReplayRequestBodyMatcher,
    ReplayResponseDefinition,
} from './replay.types.js';

const EMPTY_FIELDS = {
    exact: {},
    present: [],
    absent: [],
};

function expectation(
    id: string,
    options: {
        origin?: string;
        method?: ReplayExpectation['method'];
        path?: string;
        query?: ReplayExpectation['request']['query'];
        headers?: ReplayExpectation['request']['headers'];
        cookies?: ReplayExpectation['request']['cookies'];
        body?: ReplayRequestBodyMatcher;
        response?: ReplayResponseDefinition;
    } = {}
): ReplayExpectation {
    return {
        id,
        operation: id,
        origin: options.origin ?? 'portal',
        method: options.method ?? 'GET',
        path: options.path ?? `/${id}`,
        request: {
            query: options.query ?? EMPTY_FIELDS,
            headers: options.headers ?? EMPTY_FIELDS,
            cookies: options.cookies ?? {
                ...EMPTY_FIELDS,
                attributes: {},
            },
            body: options.body ?? { kind: 'absent' },
        },
        response: options.response ?? {
            status: 200,
            headers: {
                'content-type': ['application/json'],
            },
            body: { kind: 'json', value: { js: true } },
        },
        cardinality: { min: 1, max: 1 },
    };
}

function fixture(
    phases: ReplayFixtureV1['phases'],
    options: {
        origins?: ReplayFixtureV1['origins'];
        entry?: ReplayFixtureV1['entry'];
        expectedEndpoint?: ReplayFixtureV1['expectedEndpoint'];
        symbols?: ReplayFixtureV1['symbols'];
    } = {}
): ReplayFixtureV1 {
    return {
        schemaVersion: 1,
        scenarioId: 'network-contract',
        origins: options.origins ?? { portal: {} },
        entry: options.entry ?? { origin: 'portal', path: '/entry' },
        expectedEndpoint:
            options.expectedEndpoint ?? {
                origin: 'portal',
                path: phases.at(-1)!.expectations.at(-1)!.path,
            },
        initialState: phases[0]!.state,
        terminalState: phases.at(-1)!.nextState,
        failOnUnexpectedRequest: true,
        symbols: options.symbols ?? [],
        phases,
    };
}

function orderedPhases(
    expectations: ReplayExpectation[]
): ReplayFixtureV1['phases'] {
    return expectations.map((item, index) => ({
        name: `phase-${index}`,
        state: `state-${index}`,
        nextState: `state-${index + 1}`,
        mode: 'ordered',
        expectations: [item],
    }));
}

interface RawResponse {
    status: number;
    headers: string[];
    body: string;
}

function rawRequest(
    url: string,
    options: {
        method?: string;
        headers?: http.OutgoingHttpHeaders;
        body?: string;
    } = {}
): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
        const request = http.request(
            url,
            {
                method: options.method ?? 'GET',
                headers: options.headers,
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () =>
                    resolve({
                        status: response.statusCode ?? 0,
                        headers: response.rawHeaders,
                        body: Buffer.concat(chunks).toString('utf8'),
                    })
                );
            }
        );
        request.on('error', reject);
        if (options.body !== undefined) {
            request.end(options.body);
        } else {
            request.end();
        }
    });
}

function streamingRequest(
    url: string,
    headers: http.OutgoingHttpHeaders
): {
    request: http.ClientRequest;
    response: Promise<RawResponse>;
} {
    let responseStarted = false;
    let streamingResult: http.ClientRequest | undefined;
    const response = new Promise<RawResponse>((resolve, reject) => {
        const request = http.request(
            url,
            {
                method: 'POST',
                headers,
            },
            (incoming) => {
                responseStarted = true;
                const chunks: Buffer[] = [];
                incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
                incoming.on('end', () =>
                    resolve({
                        status: incoming.statusCode ?? 0,
                        headers: incoming.rawHeaders,
                        body: Buffer.concat(chunks).toString('utf8'),
                    })
                );
            }
        );
        request.on('error', (error) => {
            if (!responseStarted) {
                reject(error);
            }
        });
        streamingResult = request;
    });
    if (streamingResult === undefined) {
        throw new Error('Streaming request was not initialized.');
    }
    return { request: streamingResult, response };
}

function headerValues(rawHeaders: string[], name: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
        if (rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
            values.push(rawHeaders[index + 1]!);
        }
    }
    return values;
}

describe('ReplayServerRun listeners and routing', () => {
    const activeRuns: ReplayServerRun[] = [];

    afterEach(async () => {
        await Promise.all(activeRuns.splice(0).map((run) => run.dispose()));
    });

    it('binds one distinct ephemeral 127.0.0.1 listener per named origin and strips the run route before matching', async () => {
        const first = expectation('landing', {
            origin: 'portal',
            path: '/c/',
        });
        const second = expectation('auth', {
            origin: 'auth',
            path: '/server/load.php',
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([first, second]), {
                origins: { portal: {}, auth: {} },
                entry: { origin: 'portal', path: '/c/' },
                expectedEndpoint: {
                    origin: 'auth',
                    path: '/server/load.php',
                },
            }),
            { runId: 'run-listeners' }
        );
        activeRuns.push(run);

        const portal = new URL(run.originUrls['portal']!);
        const auth = new URL(run.originUrls['auth']!);
        expect(portal.hostname).toBe('127.0.0.1');
        expect(auth.hostname).toBe('127.0.0.1');
        expect(Number(portal.port)).toBeGreaterThan(0);
        expect(Number(auth.port)).toBeGreaterThan(0);
        expect(portal.port).not.toBe(auth.port);
        expect(portal.pathname).toContain('/run-listeners');
        expect(run.entryUrl).toBe(`${run.originUrls['portal']}/c/`);

        await expect(fetch(run.entryUrl)).resolves.toMatchObject({
            status: 200,
        });
        await expect(
            fetch(`${run.originUrls['auth']}/server/load.php`)
        ).resolves.toMatchObject({ status: 200 });
        expect(run.finalize().ok).toBe(true);
    });

    it('keeps simultaneous runs and their generated inputs isolated', async () => {
        const scenario = fixture(
            orderedPhases([
                expectation('entry', {
                    path: '/entry',
                }),
            ]),
            {
                symbols: [
                    { kind: 'generate', symbol: 'mac', valueKind: 'mac' },
                ],
            }
        );
        const first = await createReplayServerRun(scenario, {
            runId: 'run-one',
        });
        const second = await createReplayServerRun(scenario, {
            runId: 'run-two',
        });
        activeRuns.push(first, second);

        expect(first.entryUrl).not.toBe(second.entryUrl);
        expect(first.generatedInputs['mac']).not.toBe(
            second.generatedInputs['mac']
        );
        await fetch(first.entryUrl);
        expect(first.finalize().ok).toBe(true);
        expect(second.finalize()).toMatchObject({
            ok: false,
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'unmet-cardinality' }),
            ]),
        });
    });
});

describe('ReplayServerRun redirects and wire preservation', () => {
    const activeRuns: ReplayServerRun[] = [];

    afterEach(async () => {
        await Promise.all(activeRuns.splice(0).map((run) => run.dispose()));
    });

    it('keeps an absolute-path redirect on the same synthetic run origin', async () => {
        const redirect = expectation('redirect', {
            path: '/entry',
            response: {
                status: 302,
                headers: { location: ['/landing'] },
                body: { kind: 'empty' },
            },
        });
        const landing = expectation('landing', { path: '/landing' });
        const run = await createReplayServerRun(
            fixture(orderedPhases([redirect, landing]), {
                entry: { origin: 'portal', path: '/entry' },
                expectedEndpoint: { origin: 'portal', path: '/landing' },
            }),
            { runId: 'run-relative' }
        );
        activeRuns.push(run);

        const first = await fetch(run.entryUrl, { redirect: 'manual' });
        const location = first.headers.get('location');
        expect(location).toBe(`${run.originUrls['portal']}/landing`);
        expect(new URL(location!).origin).toBe(
            new URL(run.entryUrl).origin
        );

        await fetch(location!);
        expect(run.finalize().ok).toBe(true);
    });

    it('renders a typed named-origin redirect as a real cross-origin absolute URL', async () => {
        const redirect = expectation('redirect', {
            path: '/entry',
            response: {
                status: 302,
                headers: {
                    location: [
                        {
                            kind: 'origin-url',
                            origin: 'auth',
                            path: '/login',
                        },
                    ],
                },
                body: { kind: 'empty' },
            },
        });
        const login = expectation('login', {
            origin: 'auth',
            path: '/login',
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([redirect, login]), {
                origins: { portal: {}, auth: {} },
                entry: { origin: 'portal', path: '/entry' },
                expectedEndpoint: { origin: 'auth', path: '/login' },
            }),
            { runId: 'run-cross-origin' }
        );
        activeRuns.push(run);

        const first = await fetch(run.entryUrl, { redirect: 'manual' });
        const location = first.headers.get('location');
        expect(location).toBe(`${run.originUrls['auth']}/login`);
        expect(new URL(location!).origin).not.toBe(
            new URL(run.entryUrl).origin
        );

        await fetch(location!);
        expect(run.finalize().ok).toBe(true);
    });

    it('parses repeated query/header values, cookies and form bodies and preserves repeated response headers', async () => {
        const request = expectation('request', {
            method: 'POST',
            path: '/portal.php',
            query: {
                exact: { tag: ['one', 'two'] },
                present: [],
                absent: [],
            },
            headers: {
                exact: { 'x-repeated': ['alpha', 'beta'] },
                present: [],
                absent: [],
            },
            cookies: {
                exact: { session: 'synthetic-cookie' },
                present: ['theme'],
                absent: ['forbidden'],
                attributes: {},
            },
            body: {
                kind: 'form',
                exact: { username: 'synthetic-user' },
                present: ['password'],
                absent: ['token'],
            },
            response: {
                status: 200,
                headers: {
                    'content-type': ['text/plain'],
                    'set-cookie': [
                        'session=rotated; Path=/; HttpOnly',
                        'theme=dark; Path=/',
                    ],
                    'x-repeated': ['one', 'two'],
                },
                body: { kind: 'text', value: 'accepted' },
            },
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([request]), {
                entry: { origin: 'portal', path: '/portal.php' },
                expectedEndpoint: {
                    origin: 'portal',
                    path: '/portal.php',
                },
            }),
            { runId: 'run-wire' }
        );
        activeRuns.push(run);

        const response = await rawRequest(
            `${run.entryUrl}?tag=one&tag=two`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    'x-repeated': ['alpha', 'beta'],
                    cookie: 'session=synthetic-cookie; theme=dark',
                },
                body: 'username=synthetic-user&password=synthetic-password',
            }
        );

        expect(response).toMatchObject({ status: 200, body: 'accepted' });
        expect(headerValues(response.headers, 'set-cookie')).toEqual([
            'session=rotated; Path=/; HttpOnly',
            'theme=dark; Path=/',
        ]);
        expect(headerValues(response.headers, 'x-repeated')).toEqual([
            'one',
            'two',
        ]);
        expect(run.finalize().ok).toBe(true);
    });

    it.each([
        [
            'json',
            'application/json',
            JSON.stringify({ username: 'synthetic-user', count: 2 }),
            {
                kind: 'json',
                exact: { username: 'synthetic-user', count: 2 },
                present: [],
                absent: [],
            } satisfies ReplayRequestBodyMatcher,
        ],
        [
            'text',
            'text/plain',
            'synthetic text',
            {
                kind: 'text',
                exact: 'synthetic text',
            } satisfies ReplayRequestBodyMatcher,
        ],
    ])(
        'parses a bounded %s request body',
        async (label, contentType, body, matcher) => {
            const request = expectation(label, {
                method: 'POST',
                path: '/request',
                body: matcher,
            });
            const run = await createReplayServerRun(
                fixture(orderedPhases([request]), {
                    entry: { origin: 'portal', path: '/request' },
                    expectedEndpoint: {
                        origin: 'portal',
                        path: '/request',
                    },
                }),
                { runId: `run-body-${label}` }
            );
            activeRuns.push(run);

            const response = await rawRequest(run.entryUrl, {
                method: 'POST',
                headers: { 'content-type': contentType },
                body,
            });

            expect(response.status).toBe(200);
            expect(run.finalize().ok).toBe(true);
        }
    );

    it('rejects JSON nesting beyond the bounded matcher depth with a stable request error', async () => {
        const request = expectation('deep-json', {
            method: 'POST',
            path: '/request',
            body: {
                kind: 'json',
                exact: {},
                present: [],
                absent: [],
            },
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([request]), {
                entry: { origin: 'portal', path: '/request' },
                expectedEndpoint: {
                    origin: 'portal',
                    path: '/request',
                },
            }),
            { runId: 'run-deep-json' }
        );
        activeRuns.push(run);
        let nestedJson = 'null';
        for (let depth = 0; depth < 66; depth += 1) {
            nestedJson = `{"value":${nestedJson}}`;
        }

        const response = await rawRequest(run.entryUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: nestedJson,
        });

        expect(response).toMatchObject({
            status: 400,
            body: JSON.stringify({
                error: { code: 'invalid-request-body' },
            }),
        });
    });

    it('requires duplicate cookie names to be matched through the raw repeated-header boundary', async () => {
        const request = expectation('duplicate-cookie', {
            path: '/request',
            headers: {
                exact: {
                    cookie: ['session=first; session=second'],
                },
                present: [],
                absent: [],
            },
            cookies: {
                exact: {},
                present: [],
                absent: ['session'],
                attributes: {},
            },
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([request]), {
                entry: { origin: 'portal', path: '/request' },
                expectedEndpoint: {
                    origin: 'portal',
                    path: '/request',
                },
            }),
            { runId: 'run-duplicate-cookie' }
        );
        activeRuns.push(run);

        const response = await rawRequest(run.entryUrl, {
            headers: { cookie: 'session=first; session=second' },
        });

        expect(response.status).toBe(200);
        expect(run.finalize().ok).toBe(true);
    });

    it('rejects a request body beyond the network cap without parsing it', async () => {
        const request = expectation('oversized', {
            method: 'POST',
            path: '/request',
            body: { kind: 'json', exact: {}, present: [], absent: [] },
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([request]), {
                entry: { origin: 'portal', path: '/request' },
                expectedEndpoint: {
                    origin: 'portal',
                    path: '/request',
                },
            }),
            { runId: 'run-oversized' }
        );
        activeRuns.push(run);

        const response = await rawRequest(run.entryUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
        });

        expect(response.status).toBe(413);
        expect(JSON.parse(response.body)).toEqual({
            error: { code: 'request-body-too-large' },
        });
    });

    it('rejects a chunked body as soon as it crosses the cap without waiting for request end', async () => {
        const request = expectation('oversized-stream', {
            method: 'POST',
            path: '/request',
            body: { kind: 'text', exact: 'never-matched' },
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([request]), {
                entry: { origin: 'portal', path: '/request' },
                expectedEndpoint: {
                    origin: 'portal',
                    path: '/request',
                },
            }),
            { runId: 'run-oversized-stream' }
        );
        activeRuns.push(run);
        const stream = streamingRequest(run.entryUrl, {
            'content-type': 'text/plain',
        });

        stream.request.write(
            Buffer.alloc(REPLAY_MAX_REQUEST_BODY_BYTES + 1, 97)
        );

        await expect(stream.response).resolves.toMatchObject({
            status: 413,
            body: JSON.stringify({
                error: { code: 'request-body-too-large' },
            }),
        });
        stream.request.destroy();
    });

    it('times out a chunked body that never ends', async () => {
        const request = expectation('slow-stream', {
            method: 'POST',
            path: '/request',
            body: { kind: 'text', exact: 'never-matched' },
        });
        const run = await createReplayServerRun(
            fixture(orderedPhases([request]), {
                entry: { origin: 'portal', path: '/request' },
                expectedEndpoint: {
                    origin: 'portal',
                    path: '/request',
                },
            }),
            {
                runId: 'run-slow-stream',
                requestBodyTimeoutMs: 25,
            }
        );
        activeRuns.push(run);
        const stream = streamingRequest(run.entryUrl, {
            'content-type': 'text/plain',
        });

        stream.request.write('partial');

        await expect(stream.response).resolves.toMatchObject({
            status: 408,
            body: JSON.stringify({
                error: { code: 'request-body-timeout' },
            }),
        });
        stream.request.destroy();
    });
});

describe('ReplayServerRun lifecycle', () => {
    it('disposal rejects held barriers and closes every listener', async () => {
        const held = expectation('held', { path: '/held' });
        const never = expectation('never', { path: '/never' });
        const run = await createReplayServerRun(
            fixture(
                [
                    {
                        name: 'barrier',
                        state: 'start',
                        nextState: 'complete',
                        mode: 'unordered',
                        barrier: {
                            name: 'two-requests',
                            releaseWhenMatched: 2,
                        },
                        expectations: [held, never],
                    },
                ],
                {
                    entry: { origin: 'portal', path: '/held' },
                    expectedEndpoint: {
                        origin: 'portal',
                        path: '/held',
                    },
                }
            ),
            { runId: 'run-dispose' }
        );

        const heldResponse = rawRequest(run.entryUrl, {
            headers: { connection: 'close' },
        });
        for (let attempt = 0; attempt < 100; attempt += 1) {
            if (run.getLedger().operationCounts['held'] === 1) {
                break;
            }
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        expect(run.getLedger().operationCounts['held']).toBe(1);
        await run.dispose();

        await expect(heldResponse).resolves.toMatchObject({
            status: 410,
            body: JSON.stringify({ error: { code: 'run-disposed' } }),
        });
        await expect(fetch(run.entryUrl)).rejects.toThrow();
        await expect(run.dispose()).resolves.toBeUndefined();
    });

    it('exposes the sanitized nonterminal finalization result without closing before dispose', async () => {
        const run = await createReplayServerRun(
            fixture(
                orderedPhases([
                    expectation('expected', { path: '/expected' }),
                ]),
                {
                    entry: { origin: 'portal', path: '/expected' },
                }
            ),
            { runId: 'run-finalize' }
        );

        expect(run.finalize()).toMatchObject({
            ok: false,
            issues: expect.arrayContaining([
                expect.objectContaining({ code: 'unmet-cardinality' }),
                expect.objectContaining({ code: 'nonterminal-state' }),
            ]),
            ledger: {
                operationCounts: {},
                mismatchCounts: {},
                terminalState: null,
            },
        });
        await expect(fetch(run.entryUrl)).resolves.toMatchObject({
            status: 409,
        });
        await run.dispose();
    });
});
