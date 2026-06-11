import { Agent } from 'node:https';

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
 * Builds the `https.Agent` used for remote playlist fetches.
 *
 * Certificates are validated unless insecure TLS has been explicitly opted in
 * (see {@link isInsecureTlsAllowed}).
 */
export function createPlaylistHttpsAgent(): Agent {
    return new Agent({ rejectUnauthorized: !isInsecureTlsAllowed() });
}
