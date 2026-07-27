import {
    REPLAY_MAX_FIXTURE_BYTES,
    type ReplayFixtureV1,
} from '@iptvnator/portal/stalker/replay-fixtures';
import {
    FIXTURE_VALIDATION_ERROR_CODES,
    FixtureValidationError,
    validateReplayFixtureText,
} from './fixture-validator';

function replayFixture(): ReplayFixtureV1 {
    return {
        schemaVersion: 1,
        scenarioId: 'fixture-validator-contract',
        description: 'Synthetic resolver fixture.',
        origins: { portal: {} },
        entry: { origin: 'portal', path: '/c/' },
        expectedEndpoint: { origin: 'portal', path: '/portal.php' },
        initialState: 'start',
        terminalState: 'complete',
        failOnUnexpectedRequest: true,
        symbols: [],
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
                            query: { exact: {}, present: [], absent: [] },
                            headers: { exact: {}, present: [], absent: [] },
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
                                value: {
                                    alpha: true,
                                    Zebra: true,
                                    js: true,
                                },
                            },
                        },
                        cardinality: { min: 1, max: 1 },
                    },
                ],
            },
        ],
    };
}

function expectValidationCode(text: string, code: string): void {
    try {
        validateReplayFixtureText(text);
        throw new Error('fixture unexpectedly passed');
    } catch (error) {
        expect(error).toBeInstanceOf(FixtureValidationError);
        expect((error as FixtureValidationError).code).toBe(code);
        expect((error as Error).message).toBe(
            `Stalker fixture validation failed: ${code}.`
        );
    }
}

describe('fixture validator', () => {
    it('uses the shared runtime parser and emits deterministic formatting', () => {
        const fixture = replayFixture();
        const reverseRootOrder = Object.fromEntries(
            Object.entries(fixture).reverse()
        );

        const first = validateReplayFixtureText(JSON.stringify(fixture));
        const second = validateReplayFixtureText(
            JSON.stringify(reverseRootOrder)
        );

        expect(first.fixture.scenarioId).toBe('fixture-validator-contract');
        expect(first.formatted).toBe(second.formatted);
        expect(first.formatted.endsWith('\n')).toBe(true);
        expect(first.formatted).toContain('"schemaVersion": 1');
        expect(first.formatted.indexOf('"Zebra"')).toBeLessThan(
            first.formatted.indexOf('"alpha"')
        );
    });

    it('rejects oversized input before parsing', () => {
        expectValidationCode(
            'x'.repeat(REPLAY_MAX_FIXTURE_BYTES + 1),
            FIXTURE_VALIDATION_ERROR_CODES.FixtureTooLarge
        );
    });

    it('maps every shared-parser failure to one sanitized schema code', () => {
        expectValidationCode(
            JSON.stringify({ schemaVersion: 1 }),
            FIXTURE_VALIDATION_ERROR_CODES.InvalidSchema
        );
    });

    it('preserves scanner codes without exposing the offending literal', () => {
        const secret = '00:1A:79:12:34:56';
        const fixture = { ...replayFixture(), description: secret };

        try {
            validateReplayFixtureText(JSON.stringify(fixture));
            throw new Error('fixture unexpectedly passed');
        } catch (error) {
            expect(error).toBeInstanceOf(FixtureValidationError);
            expect((error as FixtureValidationError).code).toBe(
                FIXTURE_VALIDATION_ERROR_CODES.MacLiteral
            );
            expect((error as Error).message).not.toContain(secret);
        }
    });
});
