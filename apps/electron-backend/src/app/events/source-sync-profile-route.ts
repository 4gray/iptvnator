import {
    DEFAULT_PROFILE_ID,
    isProfileId,
    PROFILE_LIMIT,
} from '@iptvnator/shared/interfaces/profiles';
import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';

export const PROFILE_OPERATIONS = [
    'profiles-list',
    'profiles-set-enabled',
    'profiles-order',
    'profile-create',
    'profile-update',
    'profile-delete',
    'profile-unlock',
] as const;

type ProfileOperation = (typeof PROFILE_OPERATIONS)[number];
type ProfileBody = Record<string, unknown>;

export function isProfileOperation(
    operation: SourceServerRequest['operation']
): operation is ProfileOperation {
    return (PROFILE_OPERATIONS as readonly string[]).includes(operation);
}

export function profileRequestTarget(request: SourceServerRequest): {
    path: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
} | null {
    if (!isProfileOperation(request.operation)) return null;
    validateProfileRequest(request);
    const profile = request.profile as ProfileBody | undefined;
    const id = encodeURIComponent(request.id ?? '');
    switch (request.operation) {
        case 'profiles-list':
            return {
                path: '/v1/profiles',
                method: 'GET',
                headers: request.revision
                    ? { 'If-None-Match': `"profiles-${request.revision}"` }
                    : {},
            };
        case 'profiles-set-enabled':
            return {
                path: '/v1/profiles',
                method: 'PATCH',
                headers: {},
                body: profile,
            };
        case 'profiles-order':
            return {
                path: '/v1/profiles/order',
                method: 'PUT',
                headers: {},
                body: profile,
            };
        case 'profile-create':
            return {
                path: '/v1/profiles',
                method: 'POST',
                headers: {},
                body: profile,
            };
        case 'profile-update':
            return {
                path: `/v1/profiles/${id}`,
                method: 'PATCH',
                headers: {},
                body: profile,
            };
        case 'profile-delete':
            return {
                path: `/v1/profiles/${id}`,
                method: 'DELETE',
                headers: {},
                ...(profile ? { body: profile } : {}),
            };
        case 'profile-unlock':
            return {
                path: `/v1/profiles/${id}/unlock`,
                method: 'POST',
                headers: {},
                body: profile,
            };
    }
}

export function parseRetryAfter(value: unknown): number | undefined {
    if (typeof value === 'number')
        return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
}

export function isProfilePinRefusal(
    request: SourceServerRequest,
    response: SourceServerResponse
): boolean {
    return (
        isProfileOperation(request.operation) &&
        response.status === 403 &&
        isBodyWithCode(response.body, 'pin_required', 'wrong_pin')
    );
}

function validateProfileRequest(request: SourceServerRequest): void {
    if (
        request.source !== undefined ||
        request.history !== undefined ||
        request.favorite !== undefined ||
        request.activity !== undefined ||
        request.tmdbTransfer !== undefined ||
        request.cursor !== undefined ||
        request.scope !== undefined
    ) {
        invalidRequest();
    }
    const needsId = [
        'profile-update',
        'profile-delete',
        'profile-unlock',
    ].includes(request.operation);
    if (needsId) {
        if (request.id !== DEFAULT_PROFILE_ID && !isProfileId(request.id))
            invalidRequest();
    } else if (request.id !== undefined) invalidRequest();
    if (request.operation === 'profiles-list') {
        if (
            request.profile !== undefined ||
            (request.revision !== undefined &&
                !/^\d{1,15}$/.test(request.revision))
        ) {
            invalidRequest();
        }
        return;
    }
    if (request.revision !== undefined) invalidRequest();
    if (request.operation === 'profile-delete' && request.profile === undefined)
        return;
    const profile = plainBody(request.profile);
    switch (request.operation) {
        case 'profiles-set-enabled':
            keysOnly(profile, ['enabled']);
            if (typeof profile['enabled'] !== 'boolean') invalidRequest();
            return;
        case 'profiles-order':
            keysOnly(profile, ['ids']);
            validateOrder(profile['ids']);
            return;
        case 'profile-create':
            keysOnly(profile, ['name', 'colour', 'emoji', 'pin', 'kids']);
            if (
                !stringAtMost(profile['name'], 256) ||
                !optionalStringAtMost(profile['colour'], 16) ||
                !optionalStringAtMost(profile['emoji'], 64) ||
                !optionalStringAtMost(profile['pin'], 16) ||
                (profile['kids'] !== undefined &&
                    typeof profile['kids'] !== 'boolean')
            ) {
                invalidRequest();
            }
            return;
        case 'profile-update':
            keysOnly(profile, [
                'name',
                'colour',
                'emoji',
                'pin',
                'currentPin',
                'kids',
            ]);
            if (
                Object.keys(profile).length === 0 ||
                !optionalStringAtMost(profile['name'], 256) ||
                !optionalStringAtMost(profile['colour'], 16) ||
                !optionalStringOrNullAtMost(profile['emoji'], 64) ||
                !optionalPinOrNull(profile['pin']) ||
                !optionalStringAtMost(profile['currentPin'], 16) ||
                (profile['kids'] !== undefined &&
                    typeof profile['kids'] !== 'boolean')
            ) {
                invalidRequest();
            }
            return;
        case 'profile-delete':
            keysOnly(profile, ['currentPin']);
            if (!optionalStringAtMost(profile['currentPin'], 16))
                invalidRequest();
            return;
        case 'profile-unlock':
            keysOnly(profile, ['pin']);
            if (!stringAtMost(profile['pin'], 16)) invalidRequest();
            return;
    }
}

function plainBody(value: unknown): ProfileBody {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalidRequest();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidRequest();
    return value as ProfileBody;
}

function keysOnly(body: ProfileBody, allowed: string[]): void {
    if (Object.keys(body).some((key) => !allowed.includes(key)))
        invalidRequest();
}

function validateOrder(value: unknown): void {
    if (
        !Array.isArray(value) ||
        value.length < 1 ||
        value.length > PROFILE_LIMIT + 1 ||
        value.some((id) => id !== DEFAULT_PROFILE_ID && !isProfileId(id)) ||
        new Set(value).size !== value.length
    ) {
        invalidRequest();
    }
}

function stringAtMost(value: unknown, maximum: number): value is string {
    return typeof value === 'string' && value.length <= maximum;
}

function optionalStringAtMost(value: unknown, maximum: number): boolean {
    return value === undefined || stringAtMost(value, maximum);
}

function optionalStringOrNullAtMost(value: unknown, maximum: number): boolean {
    return value === null || optionalStringAtMost(value, maximum);
}

function optionalPinOrNull(value: unknown): boolean {
    return value === null || optionalStringAtMost(value, 16);
}

function isBodyWithCode(
    value: unknown,
    ...codes: string[]
): value is { code: string } {
    return (
        !!value &&
        typeof value === 'object' &&
        'code' in value &&
        typeof value.code === 'string' &&
        codes.includes(value.code)
    );
}

function invalidRequest(): never {
    throw new Error('Invalid source request');
}
