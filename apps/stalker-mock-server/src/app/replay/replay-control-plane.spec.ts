/* eslint-disable max-lines -- The control-plane security boundary is clearer as explicit wire-level cases. */
import {
    link,
    mkdtemp,
    mkdir,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
    createReplayControlPlaneCapability,
    InMemoryReplayFixtureRepository,
    RepositoryReplayFixtureRepository,
    ReplayFixtureRepositoryError,
    REPLAY_CONTROL_CAPABILITY_HEADER,
    REPLAY_CONTROL_MAX_BODY_BYTES,
    startReplayControlPlane,
} from './replay-control-plane.js';
import { ReplayFixtureV1 } from './replay.types.js';

const TEST_CAPABILITY = 'test-capability-0123456789abcdef';

function replayFixture(): ReplayFixtureV1 {
    return {
        schemaVersion: 1,
        scenarioId: 'control-contract',
        origins: { portal: {}, auth: {} },
        entry: { origin: 'portal', path: '/entry' },
        expectedEndpoint: { origin: 'portal', path: '/entry' },
        initialState: 'start',
        terminalState: 'complete',
        failOnUnexpectedRequest: true,
        symbols: [
            { kind: 'generate', symbol: 'mac', valueKind: 'mac' },
            {
                kind: 'generate',
                symbol: 'username',
                valueKind: 'credential',
            },
            {
                kind: 'generate',
                symbol: 'password',
                valueKind: 'credential',
            },
            { kind: 'generate', symbol: 'token', valueKind: 'token' },
            { kind: 'generate', symbol: 'random', valueKind: 'random' },
            { kind: 'generate', symbol: 'cookie', valueKind: 'cookie' },
            {
                kind: 'generate',
                symbol: 'correlation',
                valueKind: 'correlation',
            },
        ],
        phases: [
            {
                name: 'request',
                state: 'start',
                nextState: 'complete',
                mode: 'ordered',
                expectations: [
                    {
                        id: 'entry',
                        operation: 'entry',
                        origin: 'portal',
                        method: 'GET',
                        path: '/entry',
                        request: {
                            query: {
                                exact: {},
                                present: [],
                                absent: [],
                            },
                            headers: {
                                exact: {},
                                present: [],
                                absent: [],
                            },
                            cookies: {
                                exact: {},
                                present: [],
                                absent: [],
                                attributes: {},
                            },
                            body: { kind: 'absent' },
                        },
                        response: {
                            status: 200,
                            headers: {
                                'content-type': ['application/json'],
                            },
                            body: {
                                kind: 'json',
                                value: { js: true },
                            },
                        },
                        cardinality: { min: 1, max: 1 },
                    },
                ],
            },
        ],
    };
}

interface ControlResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: unknown;
}

function controlRequest(
    controlUrl: string,
    action: 'create' | 'finalize' | 'dispose',
    body: unknown,
    options: {
        capability?: string;
        host?: string;
        method?: string;
        contentType?: string;
        rawBody?: string;
        origin?: string;
    } = {}
): Promise<ControlResponse> {
    const url = new URL(`/v1/replay/${action}`, controlUrl);
    const serialized = options.rawBody ?? JSON.stringify(body);
    const headers: http.OutgoingHttpHeaders = {
        host: options.host ?? url.host,
        'content-type': options.contentType ?? 'application/json',
        'content-length': Buffer.byteLength(serialized),
    };
    if (options.capability !== undefined) {
        headers[REPLAY_CONTROL_CAPABILITY_HEADER] = options.capability;
    }
    if (options.origin !== undefined) {
        headers['origin'] = options.origin;
    }

    return new Promise((resolve, reject) => {
        const request = http.request(
            url,
            {
                method: options.method ?? 'POST',
                headers,
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: response.statusCode ?? 0,
                        headers: response.headers,
                        body: text.length === 0 ? null : JSON.parse(text),
                    });
                });
            }
        );
        request.on('error', reject);
        request.end(serialized);
    });
}

function authorizedRequest(
    controlUrl: string,
    action: 'create' | 'finalize' | 'dispose',
    body: unknown
): Promise<ControlResponse> {
    return controlRequest(controlUrl, action, body, {
        capability: TEST_CAPABILITY,
    });
}

function streamingControlRequest(controlUrl: string): {
    request: http.ClientRequest;
    response: Promise<ControlResponse>;
} {
    const url = new URL('/v1/replay/create', controlUrl);
    let requestResult: http.ClientRequest | undefined;
    const response = new Promise<ControlResponse>((resolve, reject) => {
        let responseStarted = false;
        const request = http.request(
            url,
            {
                method: 'POST',
                headers: {
                    host: url.host,
                    'content-type': 'application/json',
                    [REPLAY_CONTROL_CAPABILITY_HEADER]: TEST_CAPABILITY,
                },
            },
            (incoming) => {
                responseStarted = true;
                const chunks: Buffer[] = [];
                incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
                incoming.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: incoming.statusCode ?? 0,
                        headers: incoming.headers,
                        body: text.length === 0 ? null : JSON.parse(text),
                    });
                });
            }
        );
        request.on('error', (error) => {
            if (!responseStarted) {
                reject(error);
            }
        });
        requestResult = request;
    });
    if (requestResult === undefined) {
        throw new Error('Streaming control request was not initialized.');
    }
    return { request: requestResult, response };
}

describe('replay control-plane capability and wire boundary', () => {
    it('creates cryptographically-sized process-local capabilities', () => {
        const first = createReplayControlPlaneCapability();
        const second = createReplayControlPlaneCapability();

        expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(first).not.toBe(second);
    });

    it('binds only loopback, validates the exact Host and requires the capability on every action', async () => {
        const control = await startReplayControlPlane({
            capability: TEST_CAPABILITY,
            repository: new InMemoryReplayFixtureRepository({
                'authentication/ready': replayFixture(),
            }),
        });
        try {
            const url = new URL(control.url);
            expect(url.hostname).toBe('127.0.0.1');
            expect(Number(url.port)).toBeGreaterThan(0);

            await expect(
                controlRequest(
                    control.url,
                    'create',
                    { fixtureId: 'authentication/ready' },
                    {
                        capability: TEST_CAPABILITY,
                        host: `localhost:${url.port}`,
                    }
                )
            ).resolves.toMatchObject({
                status: 400,
                body: { error: { code: 'invalid-host' } },
            });
            await expect(
                controlRequest(control.url, 'create', {
                    fixtureId: 'authentication/ready',
                })
            ).resolves.toMatchObject({
                status: 403,
                body: { error: { code: 'invalid-capability' } },
            });
            await expect(
                controlRequest(
                    control.url,
                    'create',
                    { fixtureId: 'authentication/ready' },
                    { capability: `${TEST_CAPABILITY}-wrong` }
                )
            ).resolves.toMatchObject({
                status: 403,
                body: { error: { code: 'invalid-capability' } },
            });

            const created = await authorizedRequest(
                control.url,
                'create',
                { fixtureId: 'authentication/ready' }
            );
            const runId = (created.body as { runId: string }).runId;
            await expect(
                controlRequest(control.url, 'finalize', { runId })
            ).resolves.toMatchObject({
                status: 403,
                body: { error: { code: 'invalid-capability' } },
            });
            await expect(
                controlRequest(control.url, 'dispose', { runId })
            ).resolves.toMatchObject({
                status: 403,
                body: { error: { code: 'invalid-capability' } },
            });
            await authorizedRequest(control.url, 'dispose', { runId });
        } finally {
            await control.close();
        }
    });

    it('never enables CORS and accepts only POST application/json', async () => {
        const control = await startReplayControlPlane({
            capability: TEST_CAPABILITY,
            repository: new InMemoryReplayFixtureRepository({
                ready: replayFixture(),
            }),
        });
        try {
            const preflight = await controlRequest(
                control.url,
                'create',
                {},
                {
                    capability: TEST_CAPABILITY,
                    method: 'OPTIONS',
                    origin: 'https://example.invalid',
                }
            );
            expect(preflight.status).toBe(405);
            expect(preflight.headers).not.toHaveProperty(
                'access-control-allow-origin'
            );
            expect(preflight.headers).not.toHaveProperty(
                'access-control-allow-headers'
            );

            await expect(
                controlRequest(
                    control.url,
                    'create',
                    { fixtureId: 'ready' },
                    {
                        capability: TEST_CAPABILITY,
                        contentType: 'text/plain',
                    }
                )
            ).resolves.toMatchObject({
                status: 415,
                body: { error: { code: 'json-required' } },
            });
        } finally {
            await control.close();
        }
    });

    it('enforces the 64 KiB raw cap before attempting JSON parsing', async () => {
        const control = await startReplayControlPlane({
            capability: TEST_CAPABILITY,
            repository: new InMemoryReplayFixtureRepository({}),
        });
        try {
            const oversizedInvalidJson = 'x'.repeat(
                REPLAY_CONTROL_MAX_BODY_BYTES + 1
            );
            await expect(
                controlRequest(
                    control.url,
                    'create',
                    {},
                    {
                        capability: TEST_CAPABILITY,
                        rawBody: oversizedInvalidJson,
                    }
                )
            ).resolves.toMatchObject({
                status: 413,
                body: { error: { code: 'control-body-too-large' } },
            });

            const stream = streamingControlRequest(control.url);
            stream.request.write(
                Buffer.alloc(REPLAY_CONTROL_MAX_BODY_BYTES + 1, 120)
            );
            await expect(stream.response).resolves.toMatchObject({
                status: 413,
                body: { error: { code: 'control-body-too-large' } },
            });
            stream.request.destroy();
        } finally {
            await control.close();
        }
    });

    it('times out a control body that never ends', async () => {
        const control = await startReplayControlPlane({
            capability: TEST_CAPABILITY,
            repository: new InMemoryReplayFixtureRepository({}),
            requestBodyTimeoutMs: 25,
        });
        try {
            const stream = streamingControlRequest(control.url);
            stream.request.write('{"fixtureId":');

            await expect(stream.response).resolves.toMatchObject({
                status: 408,
                body: { error: { code: 'control-body-timeout' } },
            });
            stream.request.destroy();
        } finally {
            await control.close();
        }
    });
});

describe('replay fixture repository allowlist', () => {
    let temporaryRoot: string;

    beforeEach(async () => {
        temporaryRoot = await mkdtemp(
            path.join(os.tmpdir(), 'iptvnator-replay-repository-')
        );
    });

    afterEach(async () => {
        await rm(temporaryRoot, { recursive: true, force: true });
    });

    it('loads only regular JSON fixtures beneath the configured repository root', async () => {
        const repositoryRoot = path.join(temporaryRoot, 'fixtures');
        const outsidePath = path.join(temporaryRoot, 'outside.json');
        await mkdir(path.join(repositoryRoot, 'authentication'), {
            recursive: true,
        });
        await writeFile(
            path.join(repositoryRoot, 'authentication', 'ready.json'),
            JSON.stringify(replayFixture())
        );
        await writeFile(outsidePath, JSON.stringify(replayFixture()));
        await symlink(
            outsidePath,
            path.join(repositoryRoot, 'authentication', 'escape.json')
        );
        await link(
            outsidePath,
            path.join(repositoryRoot, 'authentication', 'hardlink.json')
        );
        const repository = new RepositoryReplayFixtureRepository(
            repositoryRoot
        );

        await expect(
            repository.loadFixture('authentication/ready')
        ).resolves.toMatchObject({ scenarioId: 'control-contract' });
        await expect(
            repository.loadFixture('../outside')
        ).rejects.toMatchObject({
            code: 'fixture-not-allowed',
        });
        await expect(
            repository.loadFixture('/absolute')
        ).rejects.toBeInstanceOf(ReplayFixtureRepositoryError);
        await expect(
            repository.loadFixture('authentication/escape')
        ).rejects.toMatchObject({
            code: 'fixture-not-allowed',
        });
        await expect(
            repository.loadFixture('authentication/hardlink')
        ).rejects.toMatchObject({
            code: 'fixture-not-allowed',
        });
        await expect(
            repository.loadFixture('authentication/missing')
        ).rejects.toMatchObject({
            code: 'fixture-not-allowed',
        });
    });
});

describe('replay control-plane lifecycle and public response', () => {
    it('waits for an in-flight create and disposes the run before close resolves', async () => {
        let releaseFixture!: () => void;
        let markLoadStarted!: () => void;
        const fixtureReleased = new Promise<void>((resolve) => {
            releaseFixture = resolve;
        });
        const loadStarted = new Promise<void>((resolve) => {
            markLoadStarted = resolve;
        });
        const control = await startReplayControlPlane({
            capability: TEST_CAPABILITY,
            repository: {
                async loadFixture(): Promise<ReplayFixtureV1> {
                    markLoadStarted();
                    await fixtureReleased;
                    return replayFixture();
                },
            },
        });

        const creating = authorizedRequest(control.url, 'create', {
            fixtureId: 'authentication/deferred',
        });
        await loadStarted;
        const closing = control.close();
        releaseFixture();

        const created = await creating;
        expect(created.status).toBe(201);
        const entryUrl = (created.body as { entryUrl: string }).entryUrl;
        await closing;

        await expect(fetch(entryUrl)).rejects.toThrow();
        await expect(control.close()).resolves.toBeUndefined();
    });

    it('returns only opaque routing and filtered public inputs, then finalizes and disposes the run', async () => {
        const control = await startReplayControlPlane({
            capability: TEST_CAPABILITY,
            repository: new InMemoryReplayFixtureRepository({
                'authentication/ready': replayFixture(),
            }),
        });
        try {
            const created = await authorizedRequest(
                control.url,
                'create',
                { fixtureId: 'authentication/ready' }
            );
            expect(created.status).toBe(201);
            expect(created.headers).not.toHaveProperty(
                'access-control-allow-origin'
            );
            expect(created.body).toEqual({
                runId: expect.stringMatching(/^run-[a-f0-9]{32}$/),
                entryUrl: expect.stringMatching(
                    /^http:\/\/127\.0\.0\.1:\d+\//
                ),
                origins: {
                    auth: expect.stringMatching(
                        /^http:\/\/127\.0\.0\.1:\d+\//
                    ),
                    portal: expect.stringMatching(
                        /^http:\/\/127\.0\.0\.1:\d+\//
                    ),
                },
                inputs: {
                    mac: expect.stringMatching(/^02(?::[a-f0-9]{2}){5}$/),
                    password: expect.stringMatching(/^test-credential-/),
                    username: expect.stringMatching(/^test-credential-/),
                },
            });
            const createdText = JSON.stringify(created.body);
            expect(createdText).not.toContain(TEST_CAPABILITY);
            expect(createdText).not.toContain('test-token-');
            expect(createdText).not.toContain('test-random-');
            expect(createdText).not.toContain('test-cookie-');
            expect(createdText).not.toContain('test-correlation-');

            const publicResult = created.body as {
                runId: string;
                entryUrl: string;
            };
            await expect(fetch(publicResult.entryUrl)).resolves.toMatchObject({
                status: 200,
            });

            await expect(
                authorizedRequest(control.url, 'finalize', {
                    runId: publicResult.runId,
                })
            ).resolves.toMatchObject({
                status: 200,
                body: {
                    ok: true,
                    ledger: {
                        operationCounts: { entry: 1 },
                        mismatchCounts: {},
                        terminalState: 'complete',
                    },
                },
            });
            await expect(
                authorizedRequest(control.url, 'dispose', {
                    runId: publicResult.runId,
                })
            ).resolves.toMatchObject({
                status: 200,
                body: { disposed: true },
            });
            await expect(fetch(publicResult.entryUrl)).rejects.toThrow();
            await expect(
                authorizedRequest(control.url, 'finalize', {
                    runId: publicResult.runId,
                })
            ).resolves.toMatchObject({
                status: 404,
                body: { error: { code: 'run-not-found' } },
            });
        } finally {
            await control.close();
        }
    });

    it('rejects unknown and malformed fixture IDs with one sanitized allowlist code', async () => {
        const control = await startReplayControlPlane({
            capability: TEST_CAPABILITY,
            repository: new InMemoryReplayFixtureRepository({}),
        });
        try {
            for (const fixtureId of [
                'missing',
                '../outside',
                '/absolute',
                'authentication//ready',
                'authentication/../../outside',
            ]) {
                await expect(
                    authorizedRequest(control.url, 'create', { fixtureId })
                ).resolves.toMatchObject({
                    status: 404,
                    body: { error: { code: 'fixture-not-allowed' } },
                });
            }
        } finally {
            await control.close();
        }
    });
});
