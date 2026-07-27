import type {
    ReplayFixtureV1,
    ReplayTemplateValue,
} from '@iptvnator/portal/stalker/replay-fixtures';
import {
    assertReplayFixtureContainsNoSecrets,
    FixtureSecretScanError,
    FIXTURE_SECRET_SCAN_ERROR_CODES,
    type FixtureSecretScanErrorCode,
} from './fixture-secret-scanner';

function replayFixture(value: ReplayTemplateValue = { js: true }): ReplayFixtureV1 {
    return {
        schemaVersion: 1,
        scenarioId: 'fixture-scanner-contract',
        description:
            'Synthetic Authorization failed response at https://portal.test/c/.',
        origins: { portal: {} },
        entry: { origin: 'portal', path: '/c/' },
        expectedEndpoint: { origin: 'portal', path: '/portal.php' },
        initialState: 'start',
        terminalState: 'complete',
        failOnUnexpectedRequest: true,
        symbols: [
            {
                kind: 'generate',
                symbol: 'safe-token',
                valueKind: 'token',
            },
        ],
        phases: [
            {
                name: 'resolve',
                state: 'start',
                nextState: 'complete',
                mode: 'ordered',
                expectations: [
                    {
                        id: 'landing',
                        operation: 'landing',
                        origin: 'portal',
                        method: 'GET',
                        path: '/c/',
                        request: {
                            query: {
                                exact: {},
                                present: ['password'],
                                absent: ['token'],
                            },
                            headers: {
                                exact: {},
                                present: [],
                                absent: ['authorization'],
                            },
                            cookies: {
                                exact: {},
                                present: [],
                                absent: ['session'],
                                attributes: {},
                            },
                            body: { kind: 'absent' },
                        },
                        response: {
                            status: 200,
                            headers: {
                                'content-type': ['application/json'],
                            },
                            body: { kind: 'json', value },
                        },
                        cardinality: { min: 1, max: 1 },
                    },
                ],
            },
        ],
    };
}

function fixtureWithDescription(description: string): ReplayFixtureV1 {
    return { ...replayFixture(), description };
}

function expectScanCode(
    fixture: ReplayFixtureV1,
    code: FixtureSecretScanErrorCode
): void {
    try {
        assertReplayFixtureContainsNoSecrets(fixture);
        throw new Error('fixture unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(FixtureSecretScanError);
        expect((error as FixtureSecretScanError).code).toBe(code);
        expect((error as Error).message).toBe(
            `Stalker fixture rejected: ${code}.`
        );
    }
}

describe('fixture secret scanner', () => {
    it('allows typed symbols, protocol literals, matcher field names, and reserved test hosts', () => {
        const fixture = replayFixture({
            js: {
                token: { kind: 'ref', symbol: 'safe-token' },
                'set-cookie': {
                    kind: 'parts',
                    parts: [
                        { kind: 'literal', value: 'session=' },
                        { kind: 'ref', symbol: 'safe-token' },
                        { kind: 'literal', value: '; Path=/; HttpOnly' },
                    ],
                },
                redirect: 'https://auth.portal.test/login',
                result: 'Authorization failed',
            },
        });

        expect(() =>
            assertReplayFixtureContainsNoSecrets(fixture)
        ).not.toThrow();
    });

    it.each([
        'password=private-value',
        'password%3Dprivate-value',
        'password%253Dprivate-value',
        'pa\\u0073sword=private-value',
        '{\\"password\\":\\"private-value\\"}',
        'Set-Cookie: session=private-value',
    ])('rejects raw and encoded secret evidence without echoing it: %s', (value) => {
        expectScanCode(
            fixtureWithDescription(value),
            FIXTURE_SECRET_SCAN_ERROR_CODES.SensitiveLiteral
        );
    });

    it('scans JSON object keys for external-origin evidence', () => {
        expectScanCode(
            replayFixture({
                'https://untrusted.example.tv/account': true,
            }),
            FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl
        );
    });

    it('rejects literal fragments smuggled into credential parts', () => {
        expectScanCode(
            replayFixture({
                password: {
                    kind: 'parts',
                    parts: [
                        { kind: 'literal', value: 'private-value' },
                        { kind: 'ref', symbol: 'safe-token' },
                    ],
                },
            }),
            FIXTURE_SECRET_SCAN_ERROR_CODES.SensitiveLiteral
        );
    });

    it('rejects JWT-shaped literals', () => {
        expectScanCode(
            fixtureWithDescription(
                'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY2NvdW50In0.c2lnbmF0dXJlMTIzNDU2'
            ),
            FIXTURE_SECRET_SCAN_ERROR_CODES.JwtLiteral
        );
    });

    it('rejects literal MAC addresses', () => {
        expectScanCode(
            fixtureWithDescription('00:1A:79:12:34:56'),
            FIXTURE_SECRET_SCAN_ERROR_CODES.MacLiteral
        );
    });

    it('scans typed placeholder labels for secret evidence', () => {
        const fixture = replayFixture();
        fixture.symbols = [
            {
                kind: 'generate',
                symbol: '00:1A:79:12:34:56',
                valueKind: 'token',
            },
        ];

        expectScanCode(
            fixture,
            FIXTURE_SECRET_SCAN_ERROR_CODES.MacLiteral
        );
    });

    it.each([
        'authorization',
        'cookie',
        'set-cookie',
        'password',
        'credential',
        'username',
        'account_id',
        'device_id',
        'serial',
        'signature',
        'prehash',
    ])('rejects a raw value under sensitive key %s', (key) => {
        expectScanCode(
            replayFixture({ [key]: 'private-value' }),
            FIXTURE_SECRET_SCAN_ERROR_CODES.SensitiveLiteral
        );
    });

    it.each([
        'https://provider.example.tv/api',
        'https://stream.vendor.example.tv/live/42',
        'https://images.vendor.example.tv/poster.jpg',
        'https://untrusted.example.com/portal.php',
    ])('rejects unknown external provider evidence %s', (value) => {
        expectScanCode(
            fixtureWithDescription(value),
            FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl
        );
    });

    it.each(['stream_url', 'artwork_url', 'provider_url'])(
        'rejects a URL under sensitive fixture key %s',
        (key) => {
            expectScanCode(
                replayFixture({ [key]: 'https://media.portal.test/resource' }),
                FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl
            );
        }
    );

    it('rejects unsupported stream URL schemes', () => {
        expectScanCode(
            replayFixture({
                stream_url: 'rtsp://media.portal.test/live',
            }),
            FIXTURE_SECRET_SCAN_ERROR_CODES.ExternalUrl
        );
    });

    it('rejects suspicious high-entropy literals', () => {
        expectScanCode(
            fixtureWithDescription(
                'N7vQ2mK9xP4sR8tW3yB6cD1fG5hJ0lZ2uV7nQ9pS'
            ),
            FIXTURE_SECRET_SCAN_ERROR_CODES.HighEntropyLiteral
        );
    });

    it.each([
        '2026-07-27T03:14:15.926Z',
        1_785_123_456,
        1_785_123_456_000,
    ])('rejects nondeterministic timestamp evidence %s', (value) => {
        expectScanCode(
            replayFixture({ observedAt: value }),
            FIXTURE_SECRET_SCAN_ERROR_CODES.NondeterministicTimestamp
        );
    });

    it.each([
        0,
        4_102_444_800,
        4_102_444_800_000,
        '1970-01-01T00:00:00.000Z',
        '2100-01-01T00:00:00.000Z',
    ])('allows canonical deterministic timestamp sentinel %s', (value) => {
        expect(() =>
            assertReplayFixtureContainsNoSecrets(
                replayFixture({ observedAt: value })
            )
        ).not.toThrow();
    });
});
