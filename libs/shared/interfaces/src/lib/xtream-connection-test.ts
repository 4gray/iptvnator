import { normalizeXtreamServerUrl } from './xtream-portal.utils';

export interface XtreamConnectionFailure {
    kind: 'http' | 'tls' | 'connection' | 'unknown';
    status?: number;
    canTryHttp: boolean;
}

interface TransportFailureLike {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    response?: { status?: unknown };
    errors?: unknown;
    cause?: unknown;
}

const unknownFailure = (): XtreamConnectionFailure => ({
    kind: 'unknown',
    canTryHttp: false,
});
const TLS_VERIFY_CODES = new Set([
    'EPROTO',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'INVALID_CA',
    'PATH_LENGTH_EXCEEDED',
    'HOSTNAME_MISMATCH',
    'INVALID_PURPOSE',
]);

/** Small, credential-free evidence produced by the transport, never by a panel. */
export function describeXtreamConnectionFailure(
    error: unknown,
    initialResponded: boolean
): XtreamConnectionFailure {
    const active = new WeakSet<object>();
    const memo = new WeakMap<object, XtreamConnectionFailure>();
    let remaining = 64;
    const visit = (value: unknown): XtreamConnectionFailure => {
        if (!value || typeof value !== 'object') return unknownFailure();
        const cached = memo.get(value);
        if (cached) return cached;
        if (active.has(value) || --remaining < 0) return unknownFailure();
        active.add(value);
        const candidate = value as TransportFailureLike;
        const own = describeSingleFailure(candidate);
        const evidence: XtreamConnectionFailure[] = own ? [own] : [];
        // Node may summarize mixed IPv4/IPv6 failures with the first error's
        // code. Require positive evidence from every address and nested cause.
        if (candidate.errors !== undefined) {
            if (Array.isArray(candidate.errors) && candidate.errors.length) {
                if (candidate.errors.length > 64)
                    evidence.push(unknownFailure());
                evidence.push(...candidate.errors.slice(0, 64).map(visit));
            } else evidence.push(unknownFailure());
        }
        if (candidate.cause !== undefined)
            evidence.push(visit(candidate.cause));
        const detail =
            evidence.find((e) => e.kind === 'http') ??
            evidence.find((e) => e.kind === 'tls') ??
            evidence.find((e) => e.kind === 'connection') ??
            unknownFailure();
        const result = {
            ...detail,
            canTryHttp:
                evidence.length > 0 && evidence.every((e) => e.canTryHttp),
        };
        active.delete(value);
        memo.set(value, result);
        return result;
    };
    const result = visit(error);
    return { ...result, canTryHttp: !initialResponded && result.canTryHttp };
}

function describeSingleFailure(
    candidate: TransportFailureLike
): XtreamConnectionFailure | null {
    const status = candidate.response?.status ?? candidate.status;
    if (typeof status === 'number' && status >= 100 && status <= 599)
        return { kind: 'http', status, canTryHttp: false };
    const code = typeof candidate.code === 'string' ? candidate.code : '';
    if (!code) return null;
    const wrongVersion =
        code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
        (code === 'EPROTO' &&
            typeof candidate.message === 'string' &&
            /wrong[ _]version[ _]number/i.test(candidate.message));
    const tls = /CERT|TLS|SSL|CRL/.test(code) || TLS_VERIFY_CODES.has(code);
    return {
        kind: tls ? 'tls' : 'connection',
        canTryHttp: code === 'ECONNREFUSED' || wrongVersion,
    };
}

export function xtreamHttpAlternative(serverUrl: string): string | null {
    const url = new URL(normalizeXtreamServerUrl(serverUrl));
    if (url.protocol !== 'https:') return null;
    // URL normalizes an explicit :443 away. Nonstandard ports stay explicit.
    url.protocol = 'http:';
    return normalizeXtreamServerUrl(url.href);
}
