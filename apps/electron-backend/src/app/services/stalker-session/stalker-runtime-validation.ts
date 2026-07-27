import {
    STALKER_FAILURE_REASONS,
    normalizeStalkerMacAddress,
    normalizeStalkerSourceUrl,
} from '@iptvnator/portal/stalker/protocol';
import {
    STALKER_SESSION_CONNECTION_MODES,
    STALKER_SESSION_PROVISIONAL_REASONS,
} from '@iptvnator/shared/interfaces';
import type {
    StalkerSessionConnectionDescriptor,
    StalkerSessionIdentityOverrides,
    StalkerSessionProfilePreset,
    StalkerSessionProvisionalReason,
    StalkerSessionTransportConfiguration,
} from '@iptvnator/shared/interfaces';
import {
    STALKER_RUNTIME_LIMITS,
    STALKER_TRANSPORT_DEFAULTS,
} from './stalker-session.types';
import type {
    StalkerTransportConfig,
    StalkerValidatedRuntimeInput,
} from './stalker-session.types';

const DESCRIPTOR_KEYS = new Set([
    'connectionMode',
    'identityOverrides',
    'learnedEndpointHint',
    'macAddress',
    'playlistRef',
    'profilePreset',
    'provisionalReason',
    'sourceUrl',
    'transportConfiguration',
]);
const PROFILE_PRESET_KEYS = new Set(['id', 'version']);
const IDENTITY_OVERRIDE_KEYS = [
    'apiSignature',
    'deviceId1',
    'deviceId2',
    'firmwareVersion',
    'hardwareVersion',
    'hardwareVersion2',
    'imageVersion',
    'numberOfBanks',
    'prehash',
    'serialNumber',
    'signature1',
    'signature2',
    'videoOutput',
] as const satisfies readonly (keyof StalkerSessionIdentityOverrides)[];
const TRANSPORT_CONFIGURATION_KEYS = [
    'language',
    'locale',
    'origin',
    'originPolicy',
    'referer',
    'refererPolicy',
    'timezone',
    'userAgent',
    'xUserAgent',
] as const satisfies readonly (keyof StalkerSessionTransportConfiguration)[];
const TRANSPORT_KEYS = new Set(['maxResponseBytes', 'timeoutMs']);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type StalkerRuntimeValidationFailureReason =
    | typeof STALKER_FAILURE_REASONS.InvalidIdentityInput
    | typeof STALKER_FAILURE_REASONS.InvalidUrl;

export class StalkerRuntimeValidationError extends Error {
    constructor(readonly reason: StalkerRuntimeValidationFailureReason) {
        super(reason);
        this.name = 'StalkerRuntimeValidationError';
    }
}

function fail(reason: StalkerRuntimeValidationFailureReason): never {
    throw new StalkerRuntimeValidationError(reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
    value: Readonly<Record<string, unknown>>,
    allowedKeys: ReadonlySet<string>
): boolean {
    return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isBoundedString(value: string, maxBytes: number): boolean {
    return (
        Buffer.byteLength(value, 'utf8') <= maxBytes &&
        !CONTROL_CHARACTERS.test(value)
    );
}

function requiredString(value: unknown, maxBytes: number): string {
    if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        !isBoundedString(value, maxBytes)
    ) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }
    return value;
}

function normalizeUrl(value: unknown, optional: boolean): string | undefined {
    if (optional && (value === undefined || value === null || value === '')) {
        return undefined;
    }
    if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        !isBoundedString(value, STALKER_RUNTIME_LIMITS.urlBytes)
    ) {
        return fail(STALKER_FAILURE_REASONS.InvalidUrl);
    }

    try {
        const normalized = normalizeStalkerSourceUrl(value);
        if (!isBoundedString(normalized, STALKER_RUNTIME_LIMITS.urlBytes)) {
            return fail(STALKER_FAILURE_REASONS.InvalidUrl);
        }
        return normalized;
    } catch {
        return fail(STALKER_FAILURE_REASONS.InvalidUrl);
    }
}

function normalizeMacAddress(value: unknown): string {
    if (typeof value !== 'string' || value.length > 32) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }
    try {
        return normalizeStalkerMacAddress(value.trim());
    } catch {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }
}

function normalizeProfilePreset(value: unknown): StalkerSessionProfilePreset {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, PROFILE_PRESET_KEYS) ||
        value['id'] !== 'mag250-public-5_1-minimal-v1' ||
        value['version'] !== 1
    ) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }
    return {
        id: 'mag250-public-5_1-minimal-v1',
        version: 1,
    };
}

function normalizeOptionalStringRecord<Key extends string>(
    value: unknown,
    keys: readonly Key[],
    maxBytes: number
): Partial<Record<Key, string>> | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value) || !hasOnlyKeys(value, new Set(keys))) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }

    const normalized: Partial<Record<Key, string>> = {};
    for (const key of keys) {
        const field = value[key];
        if (field === undefined) {
            continue;
        }
        if (typeof field !== 'string') {
            return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
        }
        if (field.trim().length === 0) {
            continue;
        }
        if (!isBoundedString(field, maxBytes)) {
            return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
        }
        normalized[key] = field;
    }
    return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function normalizeIdentityOverrides(
    value: unknown
): StalkerSessionIdentityOverrides | undefined {
    return normalizeOptionalStringRecord(
        value,
        IDENTITY_OVERRIDE_KEYS,
        STALKER_RUNTIME_LIMITS.profileStringBytes
    );
}

function normalizeTransportConfiguration(
    value: unknown
): StalkerSessionTransportConfiguration | undefined {
    return normalizeOptionalStringRecord(
        value,
        TRANSPORT_CONFIGURATION_KEYS,
        STALKER_RUNTIME_LIMITS.transportStringBytes
    );
}

function normalizeProvisionalReason(
    connectionMode: unknown,
    provisionalReason: unknown
): StalkerSessionProvisionalReason | undefined {
    if (connectionMode === STALKER_SESSION_CONNECTION_MODES.PersistedOpen) {
        if (provisionalReason !== undefined) {
            return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
        }
        return undefined;
    }
    if (connectionMode !== STALKER_SESSION_CONNECTION_MODES.Provisional) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }

    const allowedReasons = Object.values(
        STALKER_SESSION_PROVISIONAL_REASONS
    ) as readonly unknown[];
    if (!allowedReasons.includes(provisionalReason)) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }
    return provisionalReason as StalkerSessionProvisionalReason;
}

function normalizeDescriptor(
    value: unknown
): StalkerSessionConnectionDescriptor {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, DESCRIPTOR_KEYS)
    ) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }

    const provisionalReason = normalizeProvisionalReason(
        value['connectionMode'],
        value['provisionalReason']
    );
    const identityOverrides = normalizeIdentityOverrides(
        value['identityOverrides']
    );
    const transportConfiguration = normalizeTransportConfiguration(
        value['transportConfiguration']
    );
    const learnedEndpointHint = normalizeUrl(
        value['learnedEndpointHint'],
        true
    );
    const base = {
        connectionMode: value['connectionMode'],
        macAddress: normalizeMacAddress(value['macAddress']),
        playlistRef: requiredString(
            value['playlistRef'],
            STALKER_RUNTIME_LIMITS.playlistRefBytes
        ).trim(),
        profilePreset: normalizeProfilePreset(value['profilePreset']),
        sourceUrl: normalizeUrl(value['sourceUrl'], false) as string,
        ...(learnedEndpointHint === undefined
            ? {}
            : { learnedEndpointHint }),
        ...(identityOverrides === undefined ? {} : { identityOverrides }),
        ...(transportConfiguration === undefined
            ? {}
            : { transportConfiguration }),
    };

    return provisionalReason === undefined
        ? {
              ...base,
              connectionMode: STALKER_SESSION_CONNECTION_MODES.PersistedOpen,
          }
        : {
              ...base,
              connectionMode: STALKER_SESSION_CONNECTION_MODES.Provisional,
              provisionalReason,
          };
}

function normalizeTransport(value: unknown): StalkerTransportConfig {
    const source = value ?? STALKER_TRANSPORT_DEFAULTS;
    if (!isRecord(source) || !hasOnlyKeys(source, TRANSPORT_KEYS)) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }

    const timeoutMs = source['timeoutMs'];
    const maxResponseBytes = source['maxResponseBytes'];
    if (
        typeof timeoutMs !== 'number' ||
        !Number.isFinite(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > STALKER_RUNTIME_LIMITS.timeoutMs ||
        typeof maxResponseBytes !== 'number' ||
        !Number.isFinite(maxResponseBytes) ||
        maxResponseBytes <= 0 ||
        maxResponseBytes > STALKER_RUNTIME_LIMITS.maxResponseBytes
    ) {
        return fail(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }

    return { maxResponseBytes, timeoutMs };
}

export function validateStalkerRuntimeInput(
    descriptor: unknown,
    transport?: unknown
): StalkerValidatedRuntimeInput {
    return {
        descriptor: normalizeDescriptor(descriptor),
        transport: normalizeTransport(transport),
    };
}
