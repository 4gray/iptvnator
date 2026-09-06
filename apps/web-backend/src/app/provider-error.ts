/**
 * Provider-facing error normalization for the web backend proxy routes.
 *
 * Outbound provider failures used to collapse into a bare `502 Bad Gateway`,
 * hiding the network error codes (`ETIMEDOUT`, `ENETUNREACH`, ...) that
 * explain what actually went wrong (#1400). These helpers surface those codes
 * in the JSON error body and in a server-side log line. The log line carries
 * only the provider hostname — never the full URL, whose query string
 * routinely holds Xtream credentials.
 */

import { ProviderRequestError } from './provider-request-error';
import { providerUrlErrorBody } from './provider-url-policy';

export interface ProviderError extends Error {
    readonly code?: unknown;
    readonly cause?: unknown;
    readonly errors?: unknown;
    readonly response?: {
        readonly status?: number;
        readonly statusText?: string;
    };
}

export interface NormalizedProviderError {
    readonly message: string;
    readonly status: number;
    readonly code?: string;
}

const MAX_COLLECTED_CODES = 5;
const MAX_TRAVERSAL_DEPTH = 4;

/**
 * Collects the `code` properties of an error, its `cause` chain, and any
 * `AggregateError` members — Node's happy-eyeballs failure is an
 * `AggregateError` whose members carry the per-address codes that tell the
 * IPv6-vs-IPv4 story. Bounded so a hostile or cyclic error graph cannot spin.
 */
export function collectProviderErrorCodes(error: unknown): string[] {
    const codes: string[] = [];
    visitErrorNode(error, 0, codes, new Set());
    return codes;
}

function visitErrorNode(
    error: unknown,
    depth: number,
    codes: string[],
    seen: Set<unknown>
): void {
    if (
        !error ||
        typeof error !== 'object' ||
        depth > MAX_TRAVERSAL_DEPTH ||
        seen.has(error) ||
        codes.length >= MAX_COLLECTED_CODES
    ) {
        return;
    }
    seen.add(error);

    const candidate = error as ProviderError;
    if (
        typeof candidate.code === 'string' &&
        candidate.code.length > 0 &&
        !codes.includes(candidate.code)
    ) {
        codes.push(candidate.code);
    }

    if (Array.isArray(candidate.errors)) {
        for (const nested of candidate.errors) {
            visitErrorNode(nested, depth + 1, codes, seen);
        }
    }

    visitErrorNode(candidate.cause, depth + 1, codes, seen);
}

export function normalizeProviderError(
    error: unknown
): NormalizedProviderError {
    if (error instanceof ProviderRequestError) {
        if (error.policyError) return providerUrlErrorBody(error.policyError);
        return normalizeProviderError(error.cause);
    }
    const providerError = error as ProviderError | null | undefined;
    const response = providerError?.response;
    if (
        response &&
        (response.status !== undefined || response.statusText !== undefined)
    ) {
        return {
            message: response.statusText ?? 'Bad Gateway',
            status: response.status ?? 502,
        };
    }

    const code = collectProviderErrorCodes(error)[0];
    return {
        message: code ? `Bad Gateway (${code})` : 'Bad Gateway',
        status: 502,
        ...(code ? { code } : {}),
    };
}

export function logProviderRequestFailure(options: {
    readonly error: unknown;
    readonly route: string;
    readonly url: URL | string;
    readonly logger?: (message: string) => void;
}): void {
    const log = options.logger ?? console.error;
    log(
        `[web-backend] ${options.route} request to ${safeHostname(options.url)} failed: ${describeProviderFailure(options.error)}`
    );
}

function describeProviderFailure(error: unknown): string {
    if (error instanceof ProviderRequestError)
        return error.policyError
            ? `URL policy ${error.policyError.status}`
            : describeProviderFailure(error.cause);
    const providerError = error as ProviderError | null | undefined;
    const response = providerError?.response;
    if (
        response &&
        (response.status !== undefined || response.statusText !== undefined)
    ) {
        // The reason phrase is provider-controlled text and can echo the
        // credential-bearing request URL; only the numeric status may be
        // logged. (The statusText still reaches the client response body,
        // which the provider could see anyway.)
        return response.status !== undefined
            ? `HTTP ${response.status}`
            : 'HTTP error';
    }

    const codes = collectProviderErrorCodes(error);
    return codes.length > 0 ? codes.join(', ') : 'unknown network error';
}

function safeHostname(url: URL | string): string {
    try {
        return (url instanceof URL ? url : new URL(url)).hostname;
    } catch {
        return '<invalid url>';
    }
}
