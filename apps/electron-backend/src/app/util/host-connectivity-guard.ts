/**
 * Main-process ownership of the shared host connectivity guard.
 *
 * The breaker itself lives in `@iptvnator/shared/host-health` so the web
 * backend can run the same rules; what stays here is the part that is
 * genuinely main-process-specific: a single guard for the whole process (both
 * portal IPC handlers must see each other's evidence, or a dead endpoint would
 * be relearned once per protocol) and the console warning that announces it.
 */

import {
    classifyHostRequestFailure,
    failedAfterRedirect,
    HostConnectivityGuard,
    HostConnectivityGuardError,
    HostRequestToken,
    OPEN_DURATION_MS,
    portalEndpointKeyOf,
} from '@iptvnator/shared/host-health';

export { HostConnectivityGuardError };
export type { HostRequestToken };

let sharedGuard: HostConnectivityGuard | null = null;
let enabled = true;
let currentTokens = new WeakSet<HostRequestToken>();

/** Apply a saved desktop preference without letting old requests affect a new guard. */
export function setHostConnectivityGuardEnabled(value: boolean): void {
    if (enabled === value) return;
    enabled = value;
    sharedGuard = null;
    currentTokens = new WeakSet<HostRequestToken>();
}

/** The guard both portal IPC handlers share. */
export function getHostConnectivityGuard(): HostConnectivityGuard {
    if (!sharedGuard) {
        sharedGuard = new HostConnectivityGuard({
            onOpen: (endpoint) =>
                console.warn(
                    `[HostConnectivityGuard] ${endpoint} is not answering; skipping requests to it for ${
                        OPEN_DURATION_MS / 1000
                    }s`
                ),
        });
    }
    return sharedGuard;
}

/** Test seam: forgets the shared guard so each spec starts clean. */
export function resetHostConnectivityGuardForTests(): void {
    enabled = true;
    currentTokens = new WeakSet<HostRequestToken>();
    sharedGuard = null;
}

/**
 * Reserves a slot for a request to `url` on the shared guard.
 *
 * Throws {@link HostConnectivityGuardError} instead of letting the request hang
 * again while the breaker is open. Returns `null` for a URL with no usable
 * origin — there is nothing to track then, and refusing the request over that
 * would be worse than letting the transport report the real problem.
 */
export function beginGuardedHostRequest(url: string): HostRequestToken | null {
    const endpoint = portalEndpointKeyOf(url);
    if (!endpoint || !enabled) {
        return null;
    }

    const check = getHostConnectivityGuard().check(endpoint);
    if (!check.allowed) {
        throw new HostConnectivityGuardError(endpoint);
    }

    currentTokens.add(check.token);
    return check.token;
}

/** Untracked counterpart of {@link beginGuardedHostRequest}, see `observe`. */
export function observeGuardedHostRequest(
    url: string
): HostRequestToken | null {
    const endpoint = portalEndpointKeyOf(url);
    if (!endpoint || !enabled) return null;
    const token = getHostConnectivityGuard().observe(endpoint);
    currentTokens.add(token);
    return token;
}

export function reportGuardedHostSuccess(token: HostRequestToken | null): void {
    if (token && currentTokens.has(token)) {
        getHostConnectivityGuard().reportSuccess(token);
    }
}
/**
 * Records what a failed request proved about its endpoint.
 *
 * `countFailures: false` is for requests exempt from the guard (endpoint
 * discovery): their failures are expected and must not count, but an error that
 * still carries an HTTP response proves the origin answered, and dropping that
 * is what would let the breaker open in the middle of discovery.
 */
export function reportGuardedHostFailure(
    token: HostRequestToken | null,
    error: unknown,
    options: { countFailures?: boolean; requestUrl?: string } = {}
): void {
    if (!token || !currentTokens.has(token)) {
        return;
    }

    const guard = getHostConnectivityGuard();
    const countFailures = options.countFailures ?? true;
    switch (classifyHostRequestFailure(error)) {
        case 'host-level': {
            if (!countFailures) {
                break;
            }

            if (failedAfterRedirect(error, token, options.requestUrl)) {
                // The guarded endpoint answered with a redirect, so this clears
                // its record like any other response rather than merely
                // declining to count the downstream failure. The failing hop is
                // not guarded (it has no token of its own), so such a chain
                // keeps costing a full timeout — a documented gap.
                guard.reportSuccess(token);
                break;
            }
            guard.reportFailure(token);
            break;
        }
        case 'responded':
            guard.reportSuccess(token);
            break;
        default:
            guard.reportInconclusive(token);
            break;
    }
}

/** Forgets the recorded failures for the endpoint `url` points at. */
export function resetGuardedHost(url: string): boolean {
    const endpoint = portalEndpointKeyOf(url);
    if (!endpoint) {
        return false;
    }

    getHostConnectivityGuard().reset(endpoint);
    return true;
}
