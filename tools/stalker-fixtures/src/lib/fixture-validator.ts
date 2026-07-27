import {
    parseReplayFixtureText,
    REPLAY_MAX_FIXTURE_BYTES,
    type ReplayFixtureV1,
} from '@iptvnator/portal/stalker/replay-fixtures';
import {
    assertReplayFixtureContainsNoSecrets,
    FixtureSecretScanError,
    FIXTURE_SECRET_SCAN_ERROR_CODES,
} from './fixture-secret-scanner';

export const FIXTURE_VALIDATION_ERROR_CODES = {
    FixtureTooLarge: 'fixture-too-large',
    InvalidSchema: 'invalid-schema',
    ...FIXTURE_SECRET_SCAN_ERROR_CODES,
} as const;

export type FixtureValidationErrorCode =
    (typeof FIXTURE_VALIDATION_ERROR_CODES)[keyof typeof FIXTURE_VALIDATION_ERROR_CODES];

export class FixtureValidationError extends Error {
    constructor(readonly code: FixtureValidationErrorCode) {
        super(`Stalker fixture validation failed: ${code}.`);
        this.name = 'FixtureValidationError';
    }
}

export interface ValidatedReplayFixture {
    fixture: ReplayFixtureV1;
    formatted: string;
}

export function validateReplayFixtureText(
    text: string
): ValidatedReplayFixture {
    if (Buffer.byteLength(text) > REPLAY_MAX_FIXTURE_BYTES) {
        throw new FixtureValidationError(
            FIXTURE_VALIDATION_ERROR_CODES.FixtureTooLarge
        );
    }

    let fixture: ReplayFixtureV1;
    try {
        fixture = parseReplayFixtureText(text);
    } catch {
        throw new FixtureValidationError(
            FIXTURE_VALIDATION_ERROR_CODES.InvalidSchema
        );
    }

    try {
        assertReplayFixtureContainsNoSecrets(fixture);
    } catch (error) {
        if (error instanceof FixtureSecretScanError) {
            throw new FixtureValidationError(error.code);
        }
        throw new FixtureValidationError(
            FIXTURE_VALIDATION_ERROR_CODES.SensitiveLiteral
        );
    }

    return {
        fixture,
        formatted: `${JSON.stringify(sortJsonValue(fixture), null, 4)}\n`,
    };
}

function sortJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJsonValue);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    return Object.fromEntries(
        Object.entries(value)
            .sort(([left], [right]) => compareCodeUnits(left, right))
            .map(([key, child]) => [key, sortJsonValue(child)])
    );
}

function compareCodeUnits(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}
