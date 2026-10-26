import { extractStalkerAuthFailureBody } from '@iptvnator/shared/interfaces';
import { StalkerPortalError } from './stalker-portal-error';

/**
 * SHA1 hash using native Web Crypto API
 * Produces correct 40-character hex hash matching real Stalker clients
 */
async function sha1(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates SHA1 prehash from MAC address
 * This must match what real Stalker clients send
 */
export async function generatePrehash(macAddress: string): Promise<string> {
    // Use MAC address with colons, uppercase - this is what most clients use
    const str = macAddress.toUpperCase();
    return (await sha1(str)).toUpperCase();
}

/**
 * Generates a random string for metrics
 */
export function generateRandom(): string {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < 40; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export function toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

/** Raised when a caller abandoned the flow between portal calls. */
export class StalkerAuthAbortedError extends Error {
    constructor() {
        super('Stalker authentication was aborted');
        this.name = 'StalkerAuthAbortedError';
    }
}

export function assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new StalkerAuthAbortedError();
    }
}

/**
 * Throws when a response is one of the portal's plain-text auth-failure
 * bodies (already classified by the transport, or still raw on legacy paths).
 */
export function assertNotAuthFailure(response: unknown): void {
    const failureBody = extractStalkerAuthFailureBody(response);
    if (failureBody) {
        throw new StalkerPortalError('auth-failed', failureBody, failureBody);
    }
}
