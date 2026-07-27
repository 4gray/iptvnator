/* eslint-disable max-lines, @typescript-eslint/no-non-null-assertion -- Replay lifecycle contracts share one typed scenario harness whose asserted values are created in the same test. */
import {
    REPLAY_MAX_PENDING_BARRIER_BYTES,
    REPLAY_MAX_REQUESTS,
    REPLAY_RUN_HARD_LIFETIME_MS,
    REPLAY_RUN_INACTIVITY_MS,
} from './replay.constants.js';
import {
    createReplayRun,
    ReplayFinalizeResult,
    ReplayRun,
    ReplayRunError,
} from './replay-run.js';
import {
    ReplayExpectation,
    ReplayFixtureV1,
    ReplayObservedRequest,
    ReplayRequestBodyMatcher,
    ReplayResponseBody,
} from './replay.types.js';

function requestBodyMatcher(): ReplayRequestBodyMatcher {
    return { kind: 'absent' };
}

function replayExpectation(
    id: string,
    options: {
        requestBody?: ReplayRequestBodyMatcher;
        responseBody?: ReplayResponseBody;
        min?: number;
        max?: number;
    } = {}
): ReplayExpectation {
    return {
        id,
        operation: id,
        origin: 'portal',
        method: 'GET',
        path: '/portal.php',
        request: {
            query: {
                exact: { action: id },
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
            body: options.requestBody ?? requestBodyMatcher(),
        },
        response: {
            status: 200,
            headers: {
                'content-type': ['application/json'],
            },
            body: options.responseBody ?? {
                kind: 'json',
                value: { js: true },
            },
        },
        cardinality: {
            min: options.min ?? 1,
            max: options.max ?? options.min ?? 1,
        },
    };
}

function replayFixture(
    expectations: ReplayExpectation[],
    options: {
        barrier?: { name: string; releaseWhenMatched: number };
        mode?: 'ordered' | 'unordered';
    } = {}
): ReplayFixtureV1 {
    return {
        schemaVersion: 1,
        scenarioId: 'run-contract',
        origins: { portal: {} },
        entry: { origin: 'portal', path: '/c/' },
        expectedEndpoint: { origin: 'portal', path: '/portal.php' },
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
                name: 'only-phase',
                state: 'start',
                nextState: 'complete',
                mode: options.mode ?? 'unordered',
                barrier: options.barrier,
                expectations,
            },
        ],
    };
}

function observedRequest(
    action: string,
    overrides: Partial<ReplayObservedRequest> = {}
): ReplayObservedRequest {
    return {
        origin: 'portal',
        method: 'GET',
        path: '/portal.php',
        query: { action: [action] },
        headers: {},
        cookies: {},
        body: { kind: 'absent' },
        ...overrides,
    };
}

function issueCodes(result: ReplayFinalizeResult): string[] {
    return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('ReplayRun symbols and exact matching', () => {
    it('returns isolated safe client inputs without exposing server-issued symbols', () => {
        const first = createReplayRun(
            replayFixture([replayExpectation('handshake')]),
            { runId: 'run-a' }
        );
        const second = createReplayRun(
            replayFixture([replayExpectation('handshake')]),
            { runId: 'run-b' }
        );

        const firstSymbols = first.getGeneratedInputs();
        const secondSymbols = second.getGeneratedInputs();
        expect(firstSymbols).not.toEqual(secondSymbols);
        expect(Object.keys(firstSymbols).sort()).toEqual([
            'mac',
            'password',
            'username',
        ]);
        expect(firstSymbols['mac']).toMatch(/^02(?::[0-9a-f]{2}){5}$/);
        expect(firstSymbols['username']).toMatch(/^test-credential-[0-9a-f]+$/);
        expect(firstSymbols['password']).not.toBe(firstSymbols['username']);
        expect(firstSymbols).not.toHaveProperty('token');
        expect(firstSymbols).not.toHaveProperty('random');
        expect(firstSymbols).not.toHaveProperty('cookie');
        expect(firstSymbols).not.toHaveProperty('correlation');

        first.dispose();
        second.dispose();
    });

    it('requires a referenced value to match exactly', async () => {
        const expected = replayExpectation('profile');
        expected.request.headers.exact = {
            authorization: {
                kind: 'parts',
                parts: [
                    { kind: 'literal', value: 'Bearer ' },
                    { kind: 'ref', symbol: 'username' },
                ],
            },
        };
        const run = createReplayRun(replayFixture([expected]), {
            runId: 'exact-ref',
        });
        const credential = run.getGeneratedInputs()['username']!;

        await expect(
            run.request(
                observedRequest('profile', {
                    headers: {
                        authorization: [`Bearer ${credential}-suffix`],
                    },
                })
            )
        ).rejects.toMatchObject({ code: 'header-value-mismatch' });

        await expect(
            run.request(
                observedRequest('profile', {
                    headers: { authorization: [`Bearer ${credential}`] },
                })
            )
        ).resolves.toMatchObject({ status: 200 });
        expect(run.finalize().ok).toBe(false);
        expect(issueCodes(run.finalize())).toContain('unexpected-request');
        run.dispose();
    });

    it.each([
        [
            'absent',
            { kind: 'absent' } as ReplayRequestBodyMatcher,
            { kind: 'absent' } as const,
        ],
        [
            'json',
            {
                kind: 'json',
                exact: { username: { kind: 'ref', symbol: 'username' } },
                present: ['device'],
                absent: ['secret'],
            } as ReplayRequestBodyMatcher,
            {
                kind: 'json',
                value: { username: 'placeholder', device: 'mag' },
            } as const,
        ],
        [
            'form',
            {
                kind: 'form',
                exact: { username: { kind: 'ref', symbol: 'username' } },
                present: ['password'],
                absent: ['secret'],
            } as ReplayRequestBodyMatcher,
            {
                kind: 'form',
                value: { username: 'placeholder', password: 'test' },
            } as const,
        ],
        [
            'text',
            {
                kind: 'text',
                exact: {
                    kind: 'parts',
                    parts: [
                        { kind: 'literal', value: 'credential=' },
                        { kind: 'ref', symbol: 'username' },
                    ],
                },
            } as ReplayRequestBodyMatcher,
            { kind: 'text', value: 'placeholder' } as const,
        ],
    ])(
        'matches the %s request body discriminator',
        async (_name, matcher, body) => {
            const expected = replayExpectation('body', {
                requestBody: matcher,
            });
            const run = createReplayRun(replayFixture([expected]), {
                runId: `body-${_name}`,
            });
            const symbols = run.getGeneratedInputs();
            const resolvedBody =
                body.kind === 'json'
                    ? {
                          ...body,
                          value: {
                              ...body.value,
                              username: symbols['username']!,
                          },
                      }
                    : body.kind === 'form'
                      ? {
                            ...body,
                            value: {
                                ...body.value,
                                username: symbols['username']!,
                            },
                        }
                      : body.kind === 'text'
                        ? {
                              ...body,
                              value: `credential=${symbols['username']!}`,
                          }
                        : body;

            await expect(
                run.request(observedRequest('body', { body: resolvedBody }))
            ).resolves.toMatchObject({ status: 200 });
            expect(run.finalize().ok).toBe(true);
            run.dispose();
        }
    );

    it('matches cookie values and attributes without substring comparison', async () => {
        const expected = replayExpectation('cookie');
        expected.request.cookies = {
            exact: { session: { kind: 'ref', symbol: 'username' } },
            present: ['mac'],
            absent: ['legacy'],
            attributes: {
                session: {
                    path: '/',
                    secure: true,
                    httpOnly: true,
                    sameSite: 'lax',
                },
            },
        };
        const run = createReplayRun(replayFixture([expected]), {
            runId: 'cookie-attrs',
        });
        const symbols = run.getGeneratedInputs();

        await expect(
            run.request(
                observedRequest('cookie', {
                    cookies: {
                        mac: { value: symbols['mac']! },
                        session: {
                            value: `${symbols['username']!}-suffix`,
                            attributes: {
                                path: '/',
                                secure: true,
                                httpOnly: true,
                                sameSite: 'lax',
                            },
                        },
                    },
                })
            )
        ).rejects.toMatchObject({ code: 'cookie-value-mismatch' });
        run.dispose();
    });
});

describe('ReplayRun lifecycle and ledger', () => {
    it('records unexpected traffic with only sanitized operation/count/mismatch data', async () => {
        const run = createReplayRun(
            replayFixture([replayExpectation('profile')]),
            { runId: 'ledger-safety' }
        );
        const secret = run.getGeneratedInputs()['password']!;

        await expect(
            run.request(
                observedRequest('unknown', {
                    path: `/private/${secret}`,
                    headers: { authorization: [secret] },
                })
            )
        ).rejects.toBeInstanceOf(ReplayRunError);

        const ledger = run.getLedger();
        expect(ledger).toEqual({
            operationCounts: {},
            mismatchCounts: { 'unexpected-request': 1 },
            terminalState: null,
        });
        expect(JSON.stringify(ledger)).not.toContain(secret);
        expect(JSON.stringify(ledger)).not.toContain('/private/');
        expect(issueCodes(run.finalize())).toEqual(
            expect.arrayContaining([
                'unexpected-request',
                'unmet-cardinality',
                'nonterminal-state',
            ])
        );
        run.dispose();
    });

    it('rejects unmet cardinality and a nonterminal final state', () => {
        const run = createReplayRun(
            replayFixture([replayExpectation('profile', { min: 2, max: 2 })]),
            { runId: 'unmet' }
        );

        const result = run.finalize();

        expect(issueCodes(result)).toEqual(
            expect.arrayContaining(['unmet-cardinality', 'nonterminal-state'])
        );
        run.dispose();
    });

    it('requires the declared expected endpoint to be reached', async () => {
        const fixture = replayFixture([replayExpectation('profile')]);
        fixture.expectedEndpoint = {
            origin: 'portal',
            path: '/server/load.php',
        };
        const run = createReplayRun(fixture, {
            runId: 'expected-endpoint',
        });

        await run.request(observedRequest('profile'));

        expect(issueCodes(run.finalize())).toContain(
            'expected-endpoint-unreached'
        );
        run.dispose();
    });

    it('holds a barrier until its threshold and reports a blocked finalization', async () => {
        const run = createReplayRun(
            replayFixture(
                [replayExpectation('first'), replayExpectation('second')],
                {
                    barrier: {
                        name: 'both-arrived',
                        releaseWhenMatched: 2,
                    },
                }
            ),
            { runId: 'blocked-barrier' }
        );

        const pending = run.request(observedRequest('first'));
        const result = run.finalize();
        expect(issueCodes(result)).toEqual(
            expect.arrayContaining([
                'blocked-barrier',
                'unmet-cardinality',
                'nonterminal-state',
            ])
        );

        run.dispose();
        await expect(pending).rejects.toMatchObject({ code: 'run-disposed' });
    });

    it('releases barrier responses together and reaches the terminal state', async () => {
        const run = createReplayRun(
            replayFixture(
                [replayExpectation('first'), replayExpectation('second')],
                {
                    barrier: {
                        name: 'both-arrived',
                        releaseWhenMatched: 2,
                    },
                }
            ),
            { runId: 'released-barrier' }
        );
        let firstSettled = false;
        const first = run.request(observedRequest('first')).then((response) => {
            firstSettled = true;
            return response;
        });
        await Promise.resolve();
        expect(firstSettled).toBe(false);

        const second = run.request(observedRequest('second'));
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(run.finalize()).toMatchObject({
            ok: true,
            ledger: {
                operationCounts: { first: 1, second: 1 },
                mismatchCounts: {},
                terminalState: 'complete',
            },
        });
        run.dispose();
    });

    it('falls through a saturated unordered matcher to an eligible identical matcher', async () => {
        const first = replayExpectation('first');
        const second = replayExpectation('second');
        first.request.query.exact = { action: 'shared' };
        second.request.query.exact = { action: 'shared' };
        const run = createReplayRun(replayFixture([first, second]), {
            runId: 'unordered-saturation',
        });

        await run.request(observedRequest('shared'));
        await run.request(observedRequest('shared'));

        expect(run.finalize()).toMatchObject({
            ok: true,
            ledger: {
                operationCounts: { first: 1, second: 1 },
                mismatchCounts: {},
                terminalState: 'complete',
            },
        });
        run.dispose();
    });

    it('erases symbols and rejects requests after disposal', async () => {
        const run = createReplayRun(
            replayFixture([replayExpectation('profile')]),
            { runId: 'disposed' }
        );
        expect(Object.keys(run.getGeneratedInputs())).not.toHaveLength(0);

        run.dispose();

        expect(run.getGeneratedInputs()).toEqual({});
        await expect(
            run.request(observedRequest('profile'))
        ).rejects.toMatchObject({ code: 'run-disposed' });
    });

    it('enforces the hard lifetime and inactivity limits using the injected clock', () => {
        let now = 10_000;
        const hardExpired = createReplayRun(
            replayFixture([replayExpectation('profile')]),
            { runId: 'hard-expiry', now: () => now }
        );
        now += REPLAY_RUN_HARD_LIFETIME_MS;
        expect(issueCodes(hardExpired.finalize())).toContain('run-expired');
        hardExpired.dispose();

        now = 20_000;
        const inactive = createReplayRun(
            replayFixture([replayExpectation('profile')]),
            { runId: 'inactive-expiry', now: () => now }
        );
        now += REPLAY_RUN_INACTIVITY_MS;
        expect(issueCodes(inactive.finalize())).toContain('run-expired');
        inactive.dispose();
    });

    it('caps a run at 512 requests', async () => {
        const run = createReplayRun(
            replayFixture([
                replayExpectation('repeat', {
                    min: REPLAY_MAX_REQUESTS,
                    max: REPLAY_MAX_REQUESTS,
                }),
            ]),
            { runId: 'request-cap' }
        );

        for (let index = 0; index < REPLAY_MAX_REQUESTS; index += 1) {
            await run.request(observedRequest('repeat'));
        }
        await expect(
            run.request(observedRequest('repeat'))
        ).rejects.toMatchObject({ code: 'request-limit-exceeded' });
        run.dispose();
    });
});

describe('ReplayRun scheduled expiry and retained-byte defense', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('expires and rejects a held barrier after inactivity without another API call', async () => {
        jest.useFakeTimers({ now: 1_000 });
        const run = createReplayRun(
            replayFixture(
                [replayExpectation('held'), replayExpectation('never')],
                {
                    barrier: {
                        name: 'inactivity-expiry',
                        releaseWhenMatched: 2,
                    },
                }
            ),
            { runId: 'scheduled-inactivity' }
        );

        try {
            const pending = run.request(observedRequest('held'));
            const outcome = pending.then(
                () => undefined,
                (error: ReplayRunError) => error
            );
            expect(jest.getTimerCount()).toBe(1);

            await jest.advanceTimersByTimeAsync(REPLAY_RUN_INACTIVITY_MS);

            await expect(outcome).resolves.toMatchObject({
                code: 'run-expired',
            });
            expect(run.getLedger().mismatchCounts).toEqual({
                'run-expired': 1,
            });
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            run.dispose();
        }
    });

    it('enforces the scheduled hard lifetime while activity keeps resetting inactivity', async () => {
        jest.useFakeTimers({ now: 10_000 });
        const repeated = replayExpectation('repeat', { min: 6, max: 6 });
        const never = replayExpectation('never');
        const run = createReplayRun(
            replayFixture([repeated, never], {
                barrier: {
                    name: 'hard-expiry',
                    releaseWhenMatched: 7,
                },
            }),
            { runId: 'scheduled-hard-expiry' }
        );

        try {
            const pending = [run.request(observedRequest('repeat'))];
            const settled = pending.map((request) =>
                request.then(
                    () => ({ status: 'fulfilled' as const }),
                    (reason: ReplayRunError) => ({
                        status: 'rejected' as const,
                        reason,
                    })
                )
            );
            expect(jest.getTimerCount()).toBe(1);
            for (let index = 1; index < 6; index += 1) {
                await jest.advanceTimersByTimeAsync(
                    REPLAY_RUN_INACTIVITY_MS - 1
                );
                const request = run.request(observedRequest('repeat'));
                pending.push(request);
                settled.push(
                    request.then(
                        () => ({ status: 'fulfilled' as const }),
                        (reason: ReplayRunError) => ({
                            status: 'rejected' as const,
                            reason,
                        })
                    )
                );
            }
            await jest.advanceTimersByTimeAsync(
                REPLAY_RUN_HARD_LIFETIME_MS -
                    5 * (REPLAY_RUN_INACTIVITY_MS - 1)
            );

            expect(await Promise.all(settled)).toEqual(
                Array.from({ length: 6 }, () =>
                    expect.objectContaining({
                        status: 'rejected',
                        reason: expect.objectContaining({
                            code: 'run-expired',
                        }),
                    })
                )
            );
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            run.dispose();
        }
    });

    it('rejects a barrier that exceeds the runtime retained-byte cap', async () => {
        const repeated = replayExpectation('large', {
            min: 2,
            max: 2,
            responseBody: {
                kind: 'generated',
                byteLength: REPLAY_MAX_PENDING_BARRIER_BYTES / 2,
                byte: 97,
            },
        });
        const run = new ReplayRun(
            replayFixture([repeated], {
                barrier: {
                    name: 'runtime-cap',
                    releaseWhenMatched: 2,
                },
            }),
            { runId: 'runtime-barrier-cap' }
        );
        const first = run.request(observedRequest('large'));
        const firstOutcome = first.then(
            () => undefined,
            (error: ReplayRunError) => error
        );

        try {
            await expect(
                run.request(observedRequest('large'))
            ).rejects.toMatchObject({
                code: 'pending-barrier-bytes-exceeded',
            });
            expect(run.getLedger().mismatchCounts).toEqual({
                'pending-barrier-bytes-exceeded': 1,
            });
        } finally {
            run.dispose();
        }
        await expect(firstOutcome).resolves.toMatchObject({
            code: 'run-disposed',
        });
    });
});

describe('ReplayRun response rendering', () => {
    it('reuses one generated symbol when a response expectation repeats', async () => {
        const expected = replayExpectation('repeat-generated', {
            min: 2,
            max: 2,
            responseBody: {
                kind: 'json',
                value: {
                    token: {
                        kind: 'generate',
                        symbol: 'issued-token',
                        valueKind: 'token',
                    },
                },
            },
        });
        const run = createReplayRun(replayFixture([expected]), {
            runId: 'repeat-generated',
        });

        const first = await run.request(observedRequest('repeat-generated'));
        const second = await run.request(observedRequest('repeat-generated'));

        expect(first.body).toEqual(second.body);
        expect(JSON.parse(first.body.toString())).toEqual({
            token: expect.stringMatching(/^test-token-[0-9a-f]+$/),
        });
        expect(run.getGeneratedInputs()).not.toHaveProperty('issued-token');
        expect(run.finalize().ok).toBe(true);
        run.dispose();
    });

    it('renders typed JSON/JSONP/text values and bounded generated bytes', async () => {
        const bodies: ReplayResponseBody[] = [
            {
                kind: 'json',
                value: { token: { kind: 'ref', symbol: 'token' } },
            },
            {
                kind: 'jsonp',
                callback: 'callback',
                value: { ok: true },
            },
            {
                kind: 'text',
                value: {
                    kind: 'parts',
                    parts: [
                        { kind: 'literal', value: 'cookie=' },
                        { kind: 'ref', symbol: 'cookie' },
                    ],
                },
            },
            { kind: 'generated', byteLength: 32, byte: 97 },
        ];
        const expectations = bodies.map((body, index) =>
            replayExpectation(`response-${index}`, { responseBody: body })
        );
        const run = createReplayRun(replayFixture(expectations), {
            runId: 'responses',
        });
        const responses = [];
        for (let index = 0; index < bodies.length; index += 1) {
            responses.push(
                await run.request(observedRequest(`response-${index}`))
            );
        }

        expect(JSON.parse(responses[0]!.body.toString())).toEqual({
            token: expect.stringMatching(/^test-token-[0-9a-f]+$/),
        });
        expect(responses[1]!.body.toString()).toBe('callback({"ok":true});');
        expect(responses[2]!.body.toString()).toMatch(
            /^cookie=test-cookie-[0-9a-f]+$/
        );
        expect(responses[3]!.body).toEqual(Buffer.alloc(32, 97));
        expect(run.finalize().ok).toBe(true);
        run.dispose();
    });
});
