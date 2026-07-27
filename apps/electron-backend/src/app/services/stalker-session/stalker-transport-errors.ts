import axios from 'axios';
import {
    STALKER_FAILURE_REASONS,
    StalkerProtocolInputError,
} from '@iptvnator/portal/stalker/protocol';
import { UnsafeUrlError } from '../../events/url-safety';
import { isInvalidTlsCertificateError } from '../../util/security-errors';
import { StalkerRuntimeValidationError } from './stalker-runtime-validation';
import type { StalkerTransportError } from './stalker-session.types';

export const STALKER_TRANSPORT_CAUSE_LIMIT = 5;

const DNS_ERROR_CODES = new Set(['EAI_AGAIN', 'ENODATA', 'ENOTFOUND']);
const TIMEOUT_ERROR_CODES = new Set([
    'ECONNABORTED',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
]);
const NETWORK_ERROR_CODES = new Set([
    'EADDRNOTAVAIL',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'HOSTUNREACH',
    'NETUNREACH',
]);
const RESPONSE_TOO_LARGE =
    /maxcontentlength|content length[^]*exceed|size[^]*exceed/i;
const REDIRECT_LOOP = /redirect loop|too many redirects/i;

function readProperty(value: unknown, property: string): unknown {
    return typeof value === 'object' && value !== null
        ? Reflect.get(value, property)
        : undefined;
}

function causeChain(error: unknown): readonly unknown[] {
    const chain: unknown[] = [];
    const seen = new Set<object>();
    let current: unknown = error;

    while (chain.length < STALKER_TRANSPORT_CAUSE_LIMIT) {
        chain.push(current);
        if (typeof current !== 'object' || current === null) {
            break;
        }
        if (seen.has(current)) {
            break;
        }
        seen.add(current);
        const cause = readProperty(current, 'cause');
        if (cause === undefined) {
            break;
        }
        current = cause;
    }
    return chain;
}

function normalizedCode(value: unknown): string | undefined {
    const code = readProperty(value, 'code');
    return typeof code === 'string' ? code.toUpperCase() : undefined;
}

function isTlsCode(code: string | undefined): boolean {
    return (
        code !== undefined &&
        (code.includes('CERT') ||
            code.startsWith('ERR_SSL_') ||
            code.startsWith('ERR_TLS_'))
    );
}

function transportError(
    reason: StalkerTransportError['reason'],
    retryable: boolean
): StalkerTransportError {
    return { reason, retryable };
}

export function mapStalkerTransportError(
    error: unknown
): StalkerTransportError | undefined {
    if (
        axios.isAxiosError(error) &&
        error.response !== undefined &&
        !(
            error.code === 'ERR_BAD_RESPONSE' &&
            RESPONSE_TOO_LARGE.test(error.message)
        )
    ) {
        return undefined;
    }

    const chain = causeChain(error);
    for (const current of chain) {
        if (current instanceof StalkerRuntimeValidationError) {
            return transportError(current.reason, false);
        }
        if (current instanceof StalkerProtocolInputError) {
            return transportError(STALKER_FAILURE_REASONS.InvalidUrl, false);
        }
        if (current instanceof UnsafeUrlError) {
            return transportError(
                REDIRECT_LOOP.test(current.message)
                    ? STALKER_FAILURE_REASONS.RedirectLoop
                    : STALKER_FAILURE_REASONS.InvalidUrl,
                false
            );
        }
    }

    if (
        axios.isAxiosError(error) &&
        error.code === 'ERR_BAD_RESPONSE' &&
        RESPONSE_TOO_LARGE.test(error.message)
    ) {
        return transportError(
            STALKER_FAILURE_REASONS.ResponseTooLarge,
            false
        );
    }

    for (const current of chain) {
        const code = normalizedCode(current);
        if (DNS_ERROR_CODES.has(code ?? '')) {
            return transportError(STALKER_FAILURE_REASONS.DnsFailure, true);
        }
        if (TIMEOUT_ERROR_CODES.has(code ?? '')) {
            return transportError(
                STALKER_FAILURE_REASONS.RequestTimeout,
                true
            );
        }
        if (
            isTlsCode(code) ||
            (current instanceof Error &&
                isInvalidTlsCertificateError(current))
        ) {
            return transportError(STALKER_FAILURE_REASONS.TlsFailure, false);
        }
        if (NETWORK_ERROR_CODES.has(code ?? '')) {
            return transportError(
                STALKER_FAILURE_REASONS.NetworkUnreachable,
                true
            );
        }
    }

    if (axios.isAxiosError(error) && error.response === undefined) {
        return transportError(
            STALKER_FAILURE_REASONS.NetworkUnreachable,
            true
        );
    }
    return undefined;
}
