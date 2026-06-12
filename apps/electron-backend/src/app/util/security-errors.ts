import { ELECTRON_BRIDGE_SECURITY_ERROR_CODES } from '@iptvnator/shared/interfaces';

export const SECURITY_ERROR_PREFIX = 'IPTVNATOR_SECURITY_ERROR:';

export interface SerializedSecurityError {
    code: string;
    host?: string;
    message: string;
}

const TLS_CERTIFICATE_ERROR_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export class SecurityPolicyError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly host?: string
    ) {
        super(
            `${SECURITY_ERROR_PREFIX}${JSON.stringify({ code, host, message })}`
        );
        this.name = 'SecurityPolicyError';
    }
}

function readErrorProperty(error: unknown, property: string): unknown {
    if (!error || typeof error !== 'object') {
        return undefined;
    }
    return (error as Record<string, unknown>)[property];
}

export function isInvalidTlsCertificateError(error: unknown): boolean {
    const code = readErrorProperty(error, 'code');
    if (typeof code === 'string' && TLS_CERTIFICATE_ERROR_CODES.has(code)) {
        return true;
    }

    const cause = readErrorProperty(error, 'cause');
    const causeCode = readErrorProperty(cause, 'code');
    if (
        typeof causeCode === 'string' &&
        TLS_CERTIFICATE_ERROR_CODES.has(causeCode)
    ) {
        return true;
    }

    const message =
        error instanceof Error ? error.message : String(error ?? '');
    return /certificate|self[- ]signed|cert_altname|unable to verify/i.test(
        message
    );
}

export function parseSecurityPolicyError(
    error: unknown
): SerializedSecurityError | null {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : undefined;
    if (!message?.startsWith(SECURITY_ERROR_PREFIX)) {
        return null;
    }

    try {
        const parsed = JSON.parse(message.slice(SECURITY_ERROR_PREFIX.length));
        if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.code === 'string' &&
            typeof parsed.message === 'string'
        ) {
            return {
                code: parsed.code,
                host: typeof parsed.host === 'string' ? parsed.host : undefined,
                message: parsed.message,
            };
        }
    } catch {
        return null;
    }

    return null;
}

export function createInvalidTlsCertificateError(
    host: string | undefined,
    message = 'Certificate for this playlist host is invalid.'
): SecurityPolicyError {
    return new SecurityPolicyError(
        ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate,
        message,
        host
    );
}
