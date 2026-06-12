import { Agent } from 'node:https';
import type { LookupFunction } from 'node:net';
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

/**
 * Builds the agent factory used for remote playlist fetches.
 *
 * Certificates are validated unless insecure TLS has been explicitly opted in
 * (see {@link isInsecureTlsAllowed}). The validated request layer supplies a
 * DNS lookup pinned to the addresses approved for each redirect hop.
 */
export function createPlaylistAgentFactory(): ValidatedRequestAgentFactory & {
    createHttpsAgent(lookup?: LookupFunction): Agent;
} {
    const rejectUnauthorized = !isInsecureTlsAllowed();

    return {
        createHttpsAgent: (lookup) => new Agent({ lookup, rejectUnauthorized }),
    };
}
