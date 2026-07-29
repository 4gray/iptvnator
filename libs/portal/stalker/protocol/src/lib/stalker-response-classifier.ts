import {
    STALKER_FAILURE_REASONS,
    STALKER_JSONP_CALLBACKS,
    STALKER_PROFILE_RESULT_KINDS,
} from './stalker-protocol.constants';
import type {
    StalkerFailureReason,
    StalkerNormalizedProfileResult,
} from './stalker-protocol.types';

interface StalkerResponseEnvelopeInput {
    body: string;
    contentType?: string;
    maxBodyBytes: number;
}

interface StalkerParsedEnvelope {
    kind: 'parsed';
    format: 'json' | 'jsonp';
    value: unknown;
}

interface StalkerClassifierFailure {
    kind: 'failure';
    reason: StalkerFailureReason;
}

interface StalkerIncompatibleResponseFailure {
    kind: 'failure';
    reason: typeof STALKER_FAILURE_REASONS.IncompatibleResponse;
}

interface StalkerResponseFailureInput {
    httpStatus: number;
    rawBody?: string;
    value?: unknown;
}

const STALKER_ERROR_FIELDS = [
    'error',
    'errors',
    'error_message',
    'error_msg',
] as const;
const STALKER_BLOCK_FIELDS = [
    'blocked',
    'is_blocked',
    'account_blocked',
    'disabled',
    'banned',
] as const;
const STALKER_CREDENTIAL_FIELDS = [
    'credentials_required',
    'credential_required',
    'login_required',
    'auth_required',
    'authentication_required',
    'need_auth',
    'requires_auth',
] as const;

export function parseStalkerResponseEnvelope(
    input: StalkerResponseEnvelopeInput
): StalkerParsedEnvelope | StalkerClassifierFailure {
    if (new TextEncoder().encode(input.body).byteLength > input.maxBodyBytes) {
        return {
            kind: 'failure',
            reason: STALKER_FAILURE_REASONS.ResponseTooLarge,
        };
    }

    const mediaType = normalizeMediaType(input.contentType);
    if (mediaType === 'invalid' || !isCompatibleMediaType(mediaType)) {
        return incompatibleResponse();
    }

    const allowJsonp =
        mediaType === 'application/javascript' ||
        mediaType === 'text/javascript' ||
        mediaType === 'text/plain' ||
        mediaType === undefined;

    const json = parseJson(input.body);
    if (json.parsed) {
        return { format: 'json', kind: 'parsed', value: json.value };
    }

    if (allowJsonp) {
        const jsonp = parseAllowlistedJsonp(input.body);
        if (jsonp.parsed) {
            return { format: 'jsonp', kind: 'parsed', value: jsonp.value };
        }
    }

    return incompatibleResponse();
}

export function classifyStalkerProfile(
    value: unknown
): StalkerNormalizedProfileResult {
    const envelope = asRecord(value);
    if (!envelope) {
        return incompatibleResponse();
    }
    const profile = asRecord(envelope['js']);
    if (!profile || hasAnyIndicator(envelope, profile, STALKER_ERROR_FIELDS)) {
        return incompatibleResponse();
    }

    const status = normalizeProfileStatus(profile['status']);
    const hasBlockIndicator = hasAnyIndicator(
        envelope,
        profile,
        STALKER_BLOCK_FIELDS
    );
    const hasCredentialIndicator = hasAnyIndicator(
        envelope,
        profile,
        STALKER_CREDENTIAL_FIELDS
    );
    if (status === 0) {
        if (hasBlockIndicator || hasCredentialIndicator) {
            return incompatibleResponse();
        }
        return {
            kind: STALKER_PROFILE_RESULT_KINDS.Ready,
            profile,
            status,
        };
    }
    if (status === 1) {
        if (hasCredentialIndicator) {
            return incompatibleResponse();
        }
        return {
            kind: STALKER_PROFILE_RESULT_KINDS.Blocked,
            profile,
            status,
        };
    }
    if (status === 2) {
        if (hasBlockIndicator) {
            return incompatibleResponse();
        }
        return {
            kind: STALKER_PROFILE_RESULT_KINDS.CredentialsRequired,
            profile,
            status,
        };
    }
    if (
        profile['status'] === undefined &&
        hasRecognizedStatuslessProfileField(profile) &&
        !hasBlockIndicator &&
        !hasCredentialIndicator
    ) {
        return {
            kind: STALKER_PROFILE_RESULT_KINDS.Ready,
            profile,
            status: 'statusless',
        };
    }

    return incompatibleResponse();
}

export function classifyStalkerDoAuth(
    value: unknown
):
    | { kind: 'success' }
    | { kind: 'credentials-rejected' }
    | StalkerClassifierFailure {
    const envelope = asRecord(value);
    if (envelope?.['js'] === true) {
        return { kind: 'success' };
    }
    if (envelope?.['js'] === false) {
        return { kind: 'credentials-rejected' };
    }
    return incompatibleResponse();
}

export function classifyStalkerResponseFailure(
    input: StalkerResponseFailureInput
): { kind: 'none' } | { kind: 'token-rejected' } | StalkerClassifierFailure {
    if (input.httpStatus === 403 && looksLikePortalProtection(input.rawBody)) {
        return {
            kind: 'failure',
            reason: STALKER_FAILURE_REASONS.PortalProtectionBlocked,
        };
    }
    if (input.httpStatus === 401) {
        return { kind: 'token-rejected' };
    }
    if (input.httpStatus === 429) {
        return {
            kind: 'failure',
            reason: STALKER_FAILURE_REASONS.RateLimited,
        };
    }
    if (input.httpStatus >= 500) {
        return {
            kind: 'failure',
            reason: STALKER_FAILURE_REASONS.PortalUnavailable,
        };
    }
    if (input.httpStatus !== 200 && input.httpStatus !== 403) {
        return { kind: 'none' };
    }

    const bodyError = extractBodyError(input.value, input.rawBody);
    const bodyHasErrorIndicator = hasBodyErrorIndicator(input.value);
    if (bodyError === 'Authorization failed') {
        return { kind: 'token-rejected' };
    }
    if (bodyError === 'Access denied') {
        return {
            kind: 'failure',
            reason: STALKER_FAILURE_REASONS.AccountAccessDenied,
        };
    }
    if (
        bodyError !== undefined ||
        bodyHasErrorIndicator ||
        input.httpStatus === 403
    ) {
        return incompatibleResponse();
    }
    return { kind: 'none' };
}

function normalizeProfileStatus(value: unknown): 0 | 1 | 2 | undefined {
    if (value === 0 || value === '0') return 0;
    if (value === 1 || value === '1') return 1;
    if (value === 2 || value === '2') return 2;
    return undefined;
}

function hasRecognizedStatuslessProfileField(
    profile: Readonly<Record<string, unknown>>
): boolean {
    return [
        'id',
        'login',
        'mac',
        'name',
        'stb_type',
        'tariff_plan_id',
        'timeslot',
        'watchdog_timeout',
    ].some((field) => profile[field] !== undefined);
}

function hasAnyIndicator(
    envelope: Readonly<Record<string, unknown>>,
    profile: Readonly<Record<string, unknown>>,
    fields: readonly string[]
): boolean {
    return fields.some(
        (field) =>
            isFailureIndicator(envelope[field]) ||
            isFailureIndicator(profile[field])
    );
}

function isFailureIndicator(value: unknown): boolean {
    if (value === true) return true;
    if (typeof value === 'number') return value !== 0;
    if (value !== null && typeof value === 'object') return true;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return (
        normalized !== '' &&
        normalized !== '0' &&
        normalized !== 'false' &&
        normalized !== 'none' &&
        normalized !== 'ok'
    );
}

function normalizeMediaType(
    contentType: string | undefined
): string | undefined | 'invalid' {
    if (contentType === undefined || contentType.trim() === '')
        return undefined;
    const [rawType, ...parameters] = contentType.split(';');
    if (
        !rawType ||
        parameters.some(
            (parameter) =>
                !/^\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=(?:"[^"]*"|[!#$%&'*+\-.^_`|~0-9A-Za-z]+)\s*$/.test(
                    parameter
                )
        )
    ) {
        return 'invalid';
    }
    return rawType.trim().toLowerCase();
}

function isCompatibleMediaType(mediaType: string | undefined): boolean {
    return (
        mediaType === undefined ||
        mediaType === 'application/json' ||
        mediaType === 'text/json' ||
        mediaType === 'application/javascript' ||
        mediaType === 'text/javascript' ||
        mediaType === 'text/plain'
    );
}

function parseJson(
    body: string
): { parsed: true; value: unknown } | { parsed: false } {
    try {
        return { parsed: true, value: JSON.parse(body) };
    } catch {
        return { parsed: false };
    }
}

function parseAllowlistedJsonp(
    body: string
): { parsed: true; value: unknown } | { parsed: false } {
    const callbacks = STALKER_JSONP_CALLBACKS.join('|');
    const match = new RegExp(
        `^\\s*(?:${callbacks})\\((.*)\\);?\\s*$`,
        's'
    ).exec(body);
    return match?.[1] === undefined ? { parsed: false } : parseJson(match[1]);
}

function asRecord(
    value: unknown
): Readonly<Record<string, unknown>> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : undefined;
}

function extractBodyError(
    value: unknown,
    rawBody: string | undefined
): string | undefined {
    const envelope = asRecord(value);
    const js = asRecord(envelope?.['js']);
    const jsError = js?.['error'];
    if (typeof jsError === 'string' && jsError !== '') {
        return jsError;
    }
    const envelopeError = envelope?.['error'];
    if (typeof envelopeError === 'string' && envelopeError !== '') {
        return envelopeError;
    }
    if (value !== undefined) {
        return undefined;
    }
    return rawBody === 'Authorization failed' || rawBody === 'Access denied'
        ? rawBody
        : undefined;
}

function hasBodyErrorIndicator(value: unknown): boolean {
    const envelope = asRecord(value);
    const js = asRecord(envelope?.['js']);
    return STALKER_ERROR_FIELDS.some(
        (field) =>
            isFailureIndicator(envelope?.[field]) ||
            isFailureIndicator(js?.[field])
    );
}

function looksLikePortalProtection(body: string | undefined): boolean {
    return body === undefined
        ? false
        : /(cloudflare|captcha|cf-chl|web application firewall|just a moment)/i.test(
              body
          );
}

function incompatibleResponse(): StalkerIncompatibleResponseFailure {
    return {
        kind: 'failure',
        reason: STALKER_FAILURE_REASONS.IncompatibleResponse,
    };
}
