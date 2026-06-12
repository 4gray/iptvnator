import { Agent } from 'node:https';
import type { LookupFunction } from 'node:net';
import { normalizeHost } from '@iptvnator/shared/interfaces';
import type { ValidatedRequestAgentFactory } from './validated-axios';

const INSECURE_TLS_ENV = 'IPTVNATOR_ALLOW_INSECURE_TLS';

/**
 * Whether TLS certificate validation is disabled for remote playlist fetches.
 *
 * Secure by default. Validation is only disabled when the operator explicitly
 * opts in via `IPTVNATOR_ALLOW_INSECURE_TLS=1` (or `=true`). Some IPTV
 * providers serve self-signed or otherwise invalid certificates, so the
 * opt-out exists — but it must never be the default, otherwise every playlist
 * fetch is silently exposed to network MITM.
 */
export function isInsecureTlsAllowed(): boolean {
    const value = process.env[INSECURE_TLS_ENV]?.trim().toLowerCase();
    return value === '1' || value === 'true';
}

function shouldTrustInvalidCertificateForHost(
    url: URL | undefined,
    trustedHosts: readonly string[]
): boolean {
    if (!url) {
        return false;
    }

    const host = normalizeHost(url.hostname);
    return trustedHosts.some(
        (trustedHost) => normalizeHost(trustedHost) === host
    );
}

/**
 * Builds the agent factory used for remote playlist fetches.
 *
 * Certificates are validated unless insecure TLS has been explicitly opted in
 * (see {@link isInsecureTlsAllowed}). The validated request layer supplies a
 * DNS lookup pinned to the addresses approved for each redirect hop.
 */
export function createPlaylistAgentFactory(
    options: {
        trustedInsecureTlsHosts?: readonly string[];
    } = {}
): ValidatedRequestAgentFactory & {
    createHttpsAgent(lookup?: LookupFunction, url?: URL): Agent;
} {
    const trustedHosts = options.trustedInsecureTlsHosts ?? [];

    return {
        createHttpsAgent: (lookup, url) =>
            new Agent({
                lookup,
                rejectUnauthorized:
                    !isInsecureTlsAllowed() &&
                    !shouldTrustInvalidCertificateForHost(url, trustedHosts),
            }),
    };
}
