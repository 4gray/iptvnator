import { normalizeXtreamServerUrl } from './xtream-portal.utils';

export interface XtreamConnectionFailure {
    kind: 'http' | 'tls' | 'connection' | 'unknown';
    status?: number;
    canTryHttp: boolean;
}

/** Small, credential-free evidence produced by the transport, never by a panel. */
export function describeXtreamConnectionFailure(
    error: unknown,
    initialResponded: boolean
): XtreamConnectionFailure {
    const candidate = error as {
        code?: string;
        status?: number;
        message?: string;
        response?: { status?: number };
    } | null;
    const status = candidate?.response?.status ?? candidate?.status;
    if (status) return { kind: 'http', status, canTryHttp: false };
    const code = candidate?.code ?? '';
    // A refused port or a plaintext listener on the TLS port is positive
    // evidence. DNS, timeouts, resets and certificate failures are ambiguous.
    const wrongVersion =
        code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
        (code === 'EPROTO' &&
            /wrong[ _]version[ _]number/i.test(candidate?.message ?? ''));
    const tls = /CERT|TLS|SSL/.test(code) || code === 'EPROTO';
    return {
        kind: tls ? 'tls' : code ? 'connection' : 'unknown',
        canTryHttp:
            !initialResponded && (code === 'ECONNREFUSED' || wrongVersion),
    };
}

export function xtreamHttpAlternative(serverUrl: string): string | null {
    const url = new URL(normalizeXtreamServerUrl(serverUrl));
    if (url.protocol !== 'https:') return null;
    // URL normalizes an explicit :443 away. Nonstandard ports stay explicit.
    url.protocol = 'http:';
    return normalizeXtreamServerUrl(url.href);
}
