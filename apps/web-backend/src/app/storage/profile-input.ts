import type { Request } from 'express';
import { PROFILE_NAME_MAX_LENGTH } from '@iptvnator/shared/interfaces/profiles';
import { PROFILE_PIN } from './profile-pin';
import { StorageRequestError } from './storage-route-errors';

const COLOUR = /^#[0-9a-f]{6}$/;
/** UTF-16 units: room for ZWJ sequences and tag flags, not for mark spam. */
const EMOJI_MAX_LENGTH = 32;
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Request-body checks for the `/v1/profiles` routes. */
export function missingProfile(): StorageRequestError {
    return new StorageRequestError(
        404,
        'profile_missing',
        'The profile does not exist.'
    );
}

export function objectBody(req: Request): Record<string, unknown> {
    const body = req.body as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new StorageRequestError(
            400,
            'invalid_body',
            'Expected a JSON object.'
        );
    }
    return body as Record<string, unknown>;
}

/** Like `objectBody`, for a DELETE that may come without a body. */
export function optionalObjectBody(req: Request): Record<string, unknown> {
    return req.body === undefined ? {} : objectBody(req);
}

export function requireName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (
        !name ||
        name.length > PROFILE_NAME_MAX_LENGTH ||
        Array.from(name).some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
        )
    ) {
        throw new StorageRequestError(
            400,
            'invalid_profile_name',
            `A profile name has 1 to ${PROFILE_NAME_MAX_LENGTH} characters.`
        );
    }
    return name;
}

export function optionalColour(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !COLOUR.test(value.toLowerCase())) {
        throw new StorageRequestError(
            400,
            'invalid_profile_colour',
            'A profile colour is #rrggbb.'
        );
    }
    return value.toLowerCase();
}

export function optionalBoolean(
    value: unknown,
    field: string
): boolean | undefined {
    if (value === undefined || typeof value === 'boolean') return value;
    throw new StorageRequestError(
        400,
        'invalid_body',
        `${field} is true or false.`
    );
}

/** A kids profile relies on the parental lock, so it cannot take a PIN. */
export function requireNoKidsPin(kids: boolean, hasPin: boolean): void {
    if (kids && hasPin) {
        throw new StorageRequestError(
            400,
            'kids_profile_pin',
            'A kids profile uses the parental lock, not a profile PIN.'
        );
    }
}

/** One emoji grapheme, or `null` to remove it. */
export function optionalEmoji(value: unknown): string | null | undefined {
    if (value === undefined || value === null) return value;
    if (
        typeof value !== 'string' ||
        value.length > EMOJI_MAX_LENGTH ||
        Array.from(graphemes.segment(value)).length !== 1 ||
        !PICTOGRAPH.test(value)
    ) {
        throw new StorageRequestError(
            400,
            'invalid_profile_emoji',
            'A profile emoji is a single emoji.'
        );
    }
    return value;
}

export function optionalPin(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !PROFILE_PIN.test(value)) {
        throw new StorageRequestError(
            400,
            'invalid_pin',
            'A PIN has 4 to 8 digits.'
        );
    }
    return value;
}
