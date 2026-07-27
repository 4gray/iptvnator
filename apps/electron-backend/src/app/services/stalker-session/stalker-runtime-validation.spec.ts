import {
    STALKER_RUNTIME_LIMITS,
    STALKER_TRANSPORT_DEFAULTS,
} from './stalker-session.types';
import {
    StalkerRuntimeValidationError,
    validateStalkerRuntimeInput,
} from './stalker-runtime-validation';

const BASE_DESCRIPTOR = {
    connectionMode: 'persisted-open',
    macAddress: '00-1a-79-00-00-01',
    playlistRef: 'playlist-1',
    profilePreset: {
        id: 'mag250-public-5_1-minimal-v1',
        version: 1,
    },
    sourceUrl: 'https://portal.example/c/#discarded-fragment',
} as const;

function validationError(
    descriptor: unknown,
    transport: unknown = STALKER_TRANSPORT_DEFAULTS
): StalkerRuntimeValidationError {
    try {
        validateStalkerRuntimeInput(descriptor, transport);
    } catch (error) {
        if (error instanceof StalkerRuntimeValidationError) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected runtime validation to fail.');
}

describe('validateStalkerRuntimeInput', () => {
    it('normalizes URLs and MAC while preserving bounded explicit profile values', () => {
        const result = validateStalkerRuntimeInput(
            {
                ...BASE_DESCRIPTOR,
                identityOverrides: {
                    deviceId1: 'Device-One',
                    serialNumber: 'Serial-AbC',
                },
                learnedEndpointHint:
                    'https://portal.example/server/load.php#old',
                transportConfiguration: {
                    locale: 'de-DE',
                    timezone: 'Europe/Berlin',
                    userAgent: 'Synthetic Client/1.0',
                },
            },
            {
                maxResponseBytes: 1_048_576,
                timeoutMs: 12_000,
            }
        );

        expect(result).toEqual({
            descriptor: {
                ...BASE_DESCRIPTOR,
                identityOverrides: {
                    deviceId1: 'Device-One',
                    serialNumber: 'Serial-AbC',
                },
                learnedEndpointHint:
                    'https://portal.example/server/load.php',
                macAddress: '00:1A:79:00:00:01',
                sourceUrl: 'https://portal.example/c/',
                transportConfiguration: {
                    locale: 'de-DE',
                    timezone: 'Europe/Berlin',
                    userAgent: 'Synthetic Client/1.0',
                },
            },
            transport: {
                maxResponseBytes: 1_048_576,
                timeoutMs: 12_000,
            },
        });
    });

    it('uses finite safe transport defaults and omits blank optional strings', () => {
        const result = validateStalkerRuntimeInput({
            ...BASE_DESCRIPTOR,
            identityOverrides: {
                deviceId1: ' ',
                serialNumber: '',
            },
            transportConfiguration: {
                locale: '',
                timezone: ' ',
            },
        });

        expect(result.transport).toEqual(STALKER_TRANSPORT_DEFAULTS);
        expect(result.descriptor).not.toHaveProperty('identityOverrides');
        expect(result.descriptor).not.toHaveProperty(
            'transportConfiguration'
        );
    });

    it.each([
        'https://user:private-password@portal.example/c/',
        'https://portal.example/c/?username=private-account',
        'https://portal.example/c/?token=private-token',
        'https://portal.example/c/?mac=00%3A1A%3A79%3A00%3A00%3A01',
        'ftp://portal.example/c/',
    ])('rejects unsafe source URLs without echoing their value', (sourceUrl) => {
        const error = validationError({ ...BASE_DESCRIPTOR, sourceUrl });

        expect(error).toMatchObject({
            message: 'invalid-url',
            reason: 'invalid-url',
        });
        expect(JSON.stringify(error)).not.toContain(sourceUrl);
        expect(error.message).not.toContain(sourceUrl);
    });

    it('applies the same URL rules to a learned endpoint hint', () => {
        const learnedEndpointHint =
            'https://portal.example/server/load.php?password=private-password';
        const error = validationError({
            ...BASE_DESCRIPTOR,
            learnedEndpointHint,
        });

        expect(error.reason).toBe('invalid-url');
        expect(error.message).toBe('invalid-url');
        expect(JSON.stringify(error)).not.toContain('private-password');
    });

    it.each([
        '001A79000001',
        '00:1A:79:00:00',
        'GG:1A:79:00:00:01',
    ])('rejects invalid MAC input without echoing it', (macAddress) => {
        const error = validationError({ ...BASE_DESCRIPTOR, macAddress });

        expect(error).toMatchObject({
            message: 'invalid-identity-input',
            reason: 'invalid-identity-input',
        });
        expect(error.message).not.toContain(macAddress);
        expect(JSON.stringify(error)).not.toContain(macAddress);
    });

    it.each([
        ['playlistRef', 'x'.repeat(STALKER_RUNTIME_LIMITS.playlistRefBytes + 1)],
        [
            'sourceUrl',
            `https://portal.example/${'x'.repeat(
                STALKER_RUNTIME_LIMITS.urlBytes
            )}`,
        ],
        [
            'learnedEndpointHint',
            `https://portal.example/${'x'.repeat(
                STALKER_RUNTIME_LIMITS.urlBytes
            )}`,
        ],
    ])('rejects an oversized %s', (field, value) => {
        const error = validationError({
            ...BASE_DESCRIPTOR,
            [field]: value,
        });

        expect(error.reason).toBe(
            field === 'sourceUrl' || field === 'learnedEndpointHint'
                ? 'invalid-url'
                : 'invalid-identity-input'
        );
        expect(error.message).not.toContain(value);
    });

    it('bounds profile and transport strings and rejects unknown secret fields', () => {
        const profileValue = 'p'.repeat(
            STALKER_RUNTIME_LIMITS.profileStringBytes + 1
        );
        const transportValue = 't'.repeat(
            STALKER_RUNTIME_LIMITS.transportStringBytes + 1
        );

        expect(
            validationError({
                ...BASE_DESCRIPTOR,
                identityOverrides: { serialNumber: profileValue },
            }).reason
        ).toBe('invalid-identity-input');
        expect(
            validationError({
                ...BASE_DESCRIPTOR,
                transportConfiguration: { userAgent: transportValue },
            }).reason
        ).toBe('invalid-identity-input');

        const secret = 'private-password';
        const unknownFieldError = validationError({
            ...BASE_DESCRIPTOR,
            password: secret,
        });
        expect(unknownFieldError.reason).toBe('invalid-identity-input');
        expect(JSON.stringify(unknownFieldError)).not.toContain(secret);
    });

    it.each([
        ['timeoutMs', 0],
        ['timeoutMs', -1],
        ['timeoutMs', Number.NaN],
        ['timeoutMs', Number.POSITIVE_INFINITY],
        ['timeoutMs', STALKER_RUNTIME_LIMITS.timeoutMs + 1],
        ['maxResponseBytes', 0],
        ['maxResponseBytes', -1],
        ['maxResponseBytes', Number.NaN],
        ['maxResponseBytes', Number.POSITIVE_INFINITY],
        [
            'maxResponseBytes',
            STALKER_RUNTIME_LIMITS.maxResponseBytes + 1,
        ],
    ])('rejects invalid transport setting %s=%s', (field, value) => {
        const error = validationError(BASE_DESCRIPTOR, {
            ...STALKER_TRANSPORT_DEFAULTS,
            [field]: value,
        });

        expect(error.reason).toBe('invalid-identity-input');
        expect(error.message).toBe('invalid-identity-input');
    });
});
