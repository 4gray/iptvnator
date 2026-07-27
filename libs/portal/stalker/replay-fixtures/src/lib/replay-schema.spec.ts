/* eslint-disable max-lines, @typescript-eslint/no-non-null-assertion -- Boundary mutations target values built by the same local valid-fixture helper. */
import {
    REPLAY_MAX_EXPECTATIONS,
    REPLAY_MAX_FIXTURE_BYTES,
    REPLAY_MAX_GENERATED_BODY_BYTES,
    REPLAY_MAX_ORIGINS,
    REPLAY_MAX_PENDING_BARRIER_BYTES,
    REPLAY_MAX_PHASES,
    REPLAY_MAX_REQUESTS,
    REPLAY_RUN_HARD_LIFETIME_MS,
    REPLAY_RUN_INACTIVITY_MS,
} from './replay.constants.js';
import {
    parseReplayFixture,
    parseReplayFixtureText,
    ReplaySchemaError,
} from './replay-schema.js';

function expectation(
    id: string,
    body: unknown = { kind: 'absent' },
    responseBody: unknown = { kind: 'empty' }
): Record<string, unknown> {
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
                absent: ['forbidden'],
            },
            headers: {
                exact: {},
                present: [],
                absent: ['authorization'],
            },
            cookies: {
                exact: {},
                present: [],
                absent: [],
                attributes: {},
            },
            body,
        },
        response: {
            status: 200,
            headers: {
                'content-type': ['application/json'],
                'set-cookie': [
                    {
                        kind: 'parts',
                        parts: [
                            { kind: 'literal', value: 'session=' },
                            { kind: 'ref', symbol: 'cookie' },
                            { kind: 'literal', value: '; Path=/; HttpOnly' },
                        ],
                    },
                ],
            },
            body: responseBody,
        },
        cardinality: { min: 1, max: 1 },
    };
}

function fixture(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        scenarioId: 'schema-contract',
        description: 'Synthetic schema contract fixture.',
        origins: {
            portal: {},
            auth: {},
        },
        entry: { origin: 'portal', path: '/c/' },
        expectedEndpoint: { origin: 'portal', path: '/portal.php' },
        initialState: 'start',
        terminalState: 'complete',
        failOnUnexpectedRequest: true,
        symbols: [
            { kind: 'generate', symbol: 'mac', valueKind: 'mac' },
            {
                kind: 'generate',
                symbol: 'credential',
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
                name: 'requests',
                state: 'start',
                nextState: 'complete',
                mode: 'unordered',
                barrier: {
                    name: 'all-request-kinds',
                    releaseWhenMatched: 4,
                },
                expectations: [
                    expectation('empty', { kind: 'absent' }, { kind: 'empty' }),
                    expectation(
                        'json',
                        {
                            kind: 'json',
                            exact: {
                                mac: { kind: 'ref', symbol: 'mac' },
                            },
                            present: ['device'],
                            absent: ['password'],
                        },
                        {
                            kind: 'json',
                            value: {
                                js: {
                                    token: {
                                        kind: 'ref',
                                        symbol: 'token',
                                    },
                                },
                            },
                        }
                    ),
                    expectation(
                        'form',
                        {
                            kind: 'form',
                            exact: {
                                username: {
                                    kind: 'ref',
                                    symbol: 'credential',
                                },
                            },
                            present: ['password'],
                            absent: ['secret'],
                        },
                        {
                            kind: 'jsonp',
                            callback: 'callback',
                            value: { js: true },
                        }
                    ),
                    expectation(
                        'text',
                        {
                            kind: 'text',
                            exact: {
                                kind: 'parts',
                                parts: [
                                    { kind: 'literal', value: 'request-' },
                                    {
                                        kind: 'ref',
                                        symbol: 'correlation',
                                    },
                                ],
                            },
                        },
                        { kind: 'text', value: '<html>synthetic</html>' }
                    ),
                    expectation(
                        'generated',
                        { kind: 'absent' },
                        {
                            kind: 'generated',
                            byteLength: 1024,
                            byte: 97,
                        }
                    ),
                ],
            },
        ],
    };
}

function expectSchemaCode(value: unknown, code: string): void {
    try {
        parseReplayFixture(value);
        throw new Error('fixture unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(ReplaySchemaError);
        expect((error as ReplaySchemaError).issues).toContainEqual(
            expect.objectContaining({ code })
        );
    }
}

describe('replay fixture schema v1', () => {
    it('accepts the complete response, body matcher, symbol, phase, and barrier unions', () => {
        const parsed = parseReplayFixture(fixture());

        expect(parsed.schemaVersion).toBe(1);
        expect(parsed.origins).toEqual({ portal: {}, auth: {} });
        expect(parsed.phases[0]?.barrier).toEqual({
            name: 'all-request-kinds',
            releaseWhenMatched: 4,
        });
    });

    it('accepts repeated exact query values and a declared typed named-origin redirect', () => {
        const value = fixture();
        const firstExpectation = (
            (value['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!;
        const request = firstExpectation['request'] as Record<string, unknown>;
        request['query'] = {
            exact: { repeated: ['one', 'two'] },
            present: [],
            absent: [],
        };
        const response = firstExpectation['response'] as Record<
            string,
            unknown
        >;
        response['headers'] = {
            location: [
                {
                    kind: 'origin-url',
                    origin: 'auth',
                    path: '/login',
                    userInfo: {
                        username: {
                            kind: 'ref',
                            symbol: 'credential',
                        },
                        password: {
                            kind: 'generate',
                            symbol: 'redirect-password',
                            valueKind: 'credential',
                        },
                    },
                    query: {
                        username: {
                            kind: 'ref',
                            symbol: 'credential',
                        },
                        token: [
                            {
                                kind: 'ref',
                                symbol: 'token',
                            },
                            'synthetic-second-value',
                        ],
                    },
                },
            ],
        };

        const parsed = parseReplayFixture(value);

        expect(
            parsed.phases[0]?.expectations[0]?.request.query.exact['repeated']
        ).toEqual(['one', 'two']);
        expect(
            parsed.phases[0]?.expectations[0]?.response.headers['location']
        ).toEqual([
            {
                kind: 'origin-url',
                origin: 'auth',
                path: '/login',
                userInfo: {
                    username: {
                        kind: 'ref',
                        symbol: 'credential',
                    },
                    password: {
                        kind: 'generate',
                        symbol: 'redirect-password',
                        valueKind: 'credential',
                    },
                },
                query: {
                    username: {
                        kind: 'ref',
                        symbol: 'credential',
                    },
                    token: [
                        {
                            kind: 'ref',
                            symbol: 'token',
                        },
                        'synthetic-second-value',
                    ],
                },
            },
        ]);
    });

    it.each([
        ['leading OWS', ' \t//external.invalid/path'],
        ['trailing OWS', '/landing '],
        ['control characters', '/landing\u0000'],
        ['backslash authority', '\\\\external.invalid/path'],
        ['scheme-relative authority', '//external.invalid/path'],
        ['absolute scheme', 'HTTP://external.invalid/path'],
        ['parent dot segment', '../landing'],
        ['encoded parent dot segment', '%2e%2e/landing'],
    ])('rejects a literal Location containing %s', (_label, location) => {
        const value = fixture();
        const response = (
            (value['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!['response'] as Record<string, unknown>;
        response['headers'] = { location: [location] };

        expectSchemaCode(value, 'invalid-redirect-location');
    });

    it('rejects unknown or free-form absolute redirect origins', () => {
        const unknownOrigin = fixture();
        const unknownResponse = (
            (unknownOrigin['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!['response'] as Record<string, unknown>;
        unknownResponse['headers'] = {
            location: [
                {
                    kind: 'origin-url',
                    origin: 'undeclared',
                    path: '/login',
                },
            ],
        };
        expectSchemaCode(unknownOrigin, 'unknown-origin');

        const literalOrigin = fixture();
        const literalResponse = (
            (literalOrigin['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!['response'] as Record<string, unknown>;
        literalResponse['headers'] = {
            location: ['http://127.0.0.1:1234/login'],
        };
        expectSchemaCode(literalOrigin, 'invalid-redirect-location');
    });

    it.each([
        ['unknown response', { kind: 'binary', value: 'x' }],
        ['empty response with data', { kind: 'empty', value: null }],
        [
            'invalid JSONP callback',
            { kind: 'jsonp', callback: 'a.b', value: {} },
        ],
        [
            'invalid generated byte',
            { kind: 'generated', byteLength: 1, byte: 256 },
        ],
    ])('rejects %s', (_label, responseBody) => {
        const value = fixture();
        (
            (
                (value['phases'] as Record<string, unknown>[])[0]![
                    'expectations'
                ] as Record<string, unknown>[]
            )[0]!['response'] as Record<string, unknown>
        )['body'] = responseBody;

        expectSchemaCode(value, 'invalid-response-body');
    });

    it.each([
        { kind: 'missing' },
        { kind: 'json', exact: {}, present: [], absent: [], value: {} },
        { kind: 'form', exact: {}, present: [], absent: [], extra: true },
        { kind: 'text', exact: 'x', present: [] },
    ])('rejects an invalid request body matcher %#', (body) => {
        const value = fixture();
        (
            (value['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!['request'] = {
            ...((
                (value['phases'] as Record<string, unknown>[])[0]![
                    'expectations'
                ] as Record<string, unknown>[]
            )[0]!['request'] as Record<string, unknown>),
            body,
        };

        expectSchemaCode(value, 'invalid-request-body');
    });

    it('requires lower-case response headers with array values', () => {
        const value = fixture();
        const response = (
            (value['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!['response'] as Record<string, unknown>;
        response['headers'] = {
            Location: '/next',
            'set-cookie': 'session=x',
        };

        expectSchemaCode(value, 'invalid-response-headers');
    });

    it('rejects untyped symbols and free-form interpolation', () => {
        const untyped = fixture();
        (untyped['symbols'] as unknown[]).push({
            generate: 'token',
            value: 'real-looking-secret',
        });
        expectSchemaCode(untyped, 'invalid-symbol');

        const interpolated = fixture();
        const response = (
            (interpolated['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!['response'] as Record<string, unknown>;
        response['headers'] = {
            authorization: ['Bearer ${token}'],
        };
        expectSchemaCode(interpolated, 'free-form-interpolation');
    });

    it('requires named origins and valid entry/expected endpoint references', () => {
        const value = fixture();
        value['entry'] = { origin: 'missing', path: '/c/' };

        expectSchemaCode(value, 'unknown-origin');
    });

    it('requires exact cardinality until range transitions are modeled explicitly', () => {
        const value = fixture();
        const firstExpectation = (
            (value['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!;
        firstExpectation['cardinality'] = { min: 1, max: 2 };

        expectSchemaCode(value, 'non-exact-cardinality');
    });

    it('rejects a scenario whose minimum cardinality exceeds the run request cap', () => {
        const value = fixture();
        const phase = (value['phases'] as Record<string, unknown>[])[0]!;
        phase['barrier'] = undefined;
        phase['expectations'] = [expectation('first'), expectation('second')];
        (
            (phase['expectations'] as Record<string, unknown>[])[0]![
                'cardinality'
            ] as Record<string, unknown>
        )['min'] = 256;
        (
            (phase['expectations'] as Record<string, unknown>[])[0]![
                'cardinality'
            ] as Record<string, unknown>
        )['max'] = 256;
        (
            (phase['expectations'] as Record<string, unknown>[])[1]![
                'cardinality'
            ] as Record<string, unknown>
        )['min'] = 257;
        (
            (phase['expectations'] as Record<string, unknown>[])[1]![
                'cardinality'
            ] as Record<string, unknown>
        )['max'] = 257;

        expectSchemaCode(value, 'too-many-requests');
    });

    it('rejects an unordered sibling ref to a response-generated symbol', () => {
        const value = fixture();
        const phase = (value['phases'] as Record<string, unknown>[])[0]!;
        phase['barrier'] = undefined;
        phase['expectations'] = [
            expectation(
                'issuer',
                { kind: 'absent' },
                {
                    kind: 'json',
                    value: {
                        token: {
                            kind: 'generate',
                            symbol: 'phase-token',
                            valueKind: 'token',
                        },
                    },
                }
            ),
            expectation('consumer'),
        ];
        const consumer = (
            phase['expectations'] as Record<string, unknown>[]
        )[1]!;
        const headers = (consumer['request'] as Record<string, unknown>)[
            'headers'
        ] as Record<string, unknown>;
        headers['absent'] = [];
        headers['exact'] = {
            authorization: { kind: 'ref', symbol: 'phase-token' },
        };

        expectSchemaCode(value, 'unknown-symbol');
    });

    it('freezes the validated graph against post-validation mutation', () => {
        const parsed = parseReplayFixture(fixture());

        expect(() => {
            parsed.phases.push(parsed.phases[0]!);
        }).toThrow(TypeError);
        expect(() => {
            parsed.phases[0]!.expectations[0]!.response.headers[
                'content-type'
            ]!.push('text/plain');
        }).toThrow(TypeError);
    });
});

describe('replay fixture limits', () => {
    it('owns the exact runtime limits', () => {
        expect(REPLAY_MAX_FIXTURE_BYTES).toBe(1024 * 1024);
        expect(REPLAY_MAX_ORIGINS).toBe(8);
        expect(REPLAY_MAX_PHASES).toBe(128);
        expect(REPLAY_MAX_EXPECTATIONS).toBe(512);
        expect(REPLAY_MAX_REQUESTS).toBe(512);
        expect(REPLAY_MAX_GENERATED_BODY_BYTES).toBe(16 * 1024 * 1024);
        expect(REPLAY_MAX_PENDING_BARRIER_BYTES).toBe(32 * 1024 * 1024);
        expect(REPLAY_RUN_HARD_LIFETIME_MS).toBe(10 * 60 * 1000);
        expect(REPLAY_RUN_INACTIVITY_MS).toBe(2 * 60 * 1000);
    });

    it('accepts exactly 1 MiB and rejects one byte more', () => {
        const value = fixture();
        value['description'] = '';
        const base = JSON.stringify(value);
        value['description'] = 'x'.repeat(
            REPLAY_MAX_FIXTURE_BYTES - Buffer.byteLength(base)
        );
        const exact = JSON.stringify(value);

        expect(Buffer.byteLength(exact)).toBe(REPLAY_MAX_FIXTURE_BYTES);
        expect(() => parseReplayFixtureText(exact)).not.toThrow();
        expectSchemaCode(`${exact} `, 'fixture-too-large');
    });

    it('accepts 128 phases and rejects 129', () => {
        const value = fixture();
        value['phases'] = Array.from(
            { length: REPLAY_MAX_PHASES },
            (_, index) => ({
                name: `phase-${index}`,
                state: `state-${index}`,
                nextState:
                    index === REPLAY_MAX_PHASES - 1
                        ? 'complete'
                        : `state-${index + 1}`,
                mode: 'ordered',
                expectations: [expectation(`operation-${index}`)],
            })
        );
        value['initialState'] = 'state-0';

        expect(() => parseReplayFixture(value)).not.toThrow();
        (value['phases'] as unknown[]).push({
            name: 'phase-over-limit',
            state: 'complete',
            nextState: 'complete',
            mode: 'ordered',
            expectations: [expectation('over-limit')],
        });
        expectSchemaCode(value, 'too-many-phases');
    });

    it('accepts 512 expectations and rejects 513', () => {
        const value = fixture();
        const phase = (value['phases'] as Record<string, unknown>[])[0]!;
        phase['barrier'] = undefined;
        phase['expectations'] = Array.from(
            { length: REPLAY_MAX_EXPECTATIONS },
            (_, index) => expectation(`operation-${index}`)
        );

        expect(() => parseReplayFixture(value)).not.toThrow();
        (phase['expectations'] as unknown[]).push(expectation('over-limit'));
        expectSchemaCode(value, 'too-many-expectations');
    });

    it('accepts a 16 MiB generated body and rejects one byte more', () => {
        const value = fixture();
        const response = (
            (value['phases'] as Record<string, unknown>[])[0]![
                'expectations'
            ] as Record<string, unknown>[]
        )[0]!['response'] as Record<string, unknown>;
        response['body'] = {
            kind: 'generated',
            byteLength: REPLAY_MAX_GENERATED_BODY_BYTES,
            byte: 0,
        };

        expect(() => parseReplayFixture(value)).not.toThrow();
        response['body'] = {
            kind: 'generated',
            byteLength: REPLAY_MAX_GENERATED_BODY_BYTES + 1,
            byte: 0,
        };
        expectSchemaCode(value, 'generated-body-too-large');
    });

    it('accepts eight named origins and rejects a ninth', () => {
        const value = fixture();
        value['origins'] = Object.fromEntries(
            Array.from({ length: 8 }, (_, index) => [`origin-${index}`, {}])
        );
        value['entry'] = { origin: 'origin-0', path: '/c/' };
        value['expectedEndpoint'] = {
            origin: 'origin-0',
            path: '/portal.php',
        };
        for (const phase of value['phases'] as Record<string, unknown>[]) {
            for (const item of phase['expectations'] as Record<
                string,
                unknown
            >[]) {
                item['origin'] = 'origin-0';
            }
        }

        expect(() => parseReplayFixture(value)).not.toThrow();
        (value['origins'] as Record<string, unknown>)['origin-8'] = {};
        expectSchemaCode(value, 'too-many-origins');
    });

    it('rejects a barrier whose generated responses can retain more than 32 MiB', () => {
        const value = fixture();
        const phase = (value['phases'] as Record<string, unknown>[])[0]!;
        phase['barrier'] = {
            name: 'oversized-generated-barrier',
            releaseWhenMatched: 3,
        };
        phase['expectations'] = Array.from({ length: 3 }, (_, index) =>
            expectation(
                `generated-${index}`,
                { kind: 'absent' },
                {
                    kind: 'generated',
                    byteLength: 16 * 1024 * 1024,
                    byte: index,
                }
            )
        );

        expectSchemaCode(value, 'pending-barrier-too-large');
    });

    it('counts regular response bodies and headers in the pending barrier budget', () => {
        const value = fixture();
        const phase = (value['phases'] as Record<string, unknown>[])[0]!;
        const repeated = expectation(
            'regular-response',
            { kind: 'absent' },
            {
                kind: 'text',
                value: 'x'.repeat(192 * 1024),
            }
        );
        repeated['cardinality'] = { min: 128, max: 128 };
        (
            repeated['response'] as Record<string, unknown>
        )['headers'] = {
            'x-replay-padding': ['y'.repeat(96 * 1024)],
        };
        phase['barrier'] = {
            name: 'oversized-regular-barrier',
            releaseWhenMatched: 128,
        };
        phase['expectations'] = [repeated];

        expectSchemaCode(value, 'pending-barrier-too-large');
    });

    it('counts JSON escaping expansion in the pending barrier budget', () => {
        const value = fixture();
        const phase = (value['phases'] as Record<string, unknown>[])[0]!;
        const repeated = expectation(
            'escaped-json-response',
            { kind: 'absent' },
            {
                kind: 'json',
                value: {
                    payload: {
                        kind: 'parts',
                        parts: [
                            {
                                kind: 'literal',
                                value: '\u0001'.repeat(150 * 1024),
                            },
                        ],
                    },
                },
            }
        );
        repeated['cardinality'] = { min: 40, max: 40 };
        phase['barrier'] = {
            name: 'escaped-json-barrier',
            releaseWhenMatched: 40,
        };
        phase['expectations'] = [repeated];

        expectSchemaCode(value, 'pending-barrier-too-large');
    });
});
