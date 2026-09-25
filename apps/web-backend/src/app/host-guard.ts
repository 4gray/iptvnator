/**
 * Request timeouts and the per-host circuit breaker for the proxy routes.
 *
 * Both exist for the same reason. Every outbound call here used to be a bare
 * `axios.get()` with no `timeout`, so a provider host that accepts a connection
 * and then goes silent held the request until the OS gave up on the TCP
 * connection — minutes, not seconds, and the browser tab waited for all of it.
 * The Electron handlers have always passed an explicit timeout; these are the
 * same numbers, so the PWA and the desktop app give up at the same point.
 *
 * A timeout alone only bounds a single request. Browsing a dead portal issues
 * dozens back to back, so the breaker (shared with the Electron main process,
 * see `@iptvnator/shared/host-health`) fast-fails the rest once a host has
 * refused to answer twice in a row.
 *
 * On the axios timeout semantics: with axios 1.20's native HTTP
 * transport (`maxRedirects: 0`), each hop's `timeout` is NOT a wall-clock
 * deadline for the whole response. It bounds the time to response headers, and then continues as the socket's
 * inactivity timeout for the body. A large XMLTV or M3U download that keeps
 * delivering bytes is therefore never cut off mid-transfer — only a stalled one
 * is, which is exactly the case these numbers are meant to catch.
 */

import {
    HostConnectivityGuard,
    HostRequestToken,
    classifyHostRequestFailure,
    failedAfterRedirect,
    portalEndpointKeyOf,
} from '@iptvnator/shared/host-health';
import { buildHostConnectivityFastFailMessage } from '@iptvnator/shared/interfaces';
import { ProviderRequestError } from './provider-request-error';
import type { NormalizedProviderError } from './provider-error';

/**
 * Per-route request timeouts, matching the Electron handlers so both runtimes
 * give up at the same point:
 *
 * - `xtream` — `xtream.events.ts` (30 s for the Xtream API)
 * - `stalker` / `stalkerCreateLink` — `stalker.events.ts`; `create_link` gets
 *   longer because the portal mints a stream URL before answering
 * - `playlist` — `PLAYLIST_FETCH_TIMEOUT_MS` in `playlist-source.ts`
 * - `epg` — the EPG worker streams its download with no explicit timeout, so
 *   there is no number to copy; it takes the playlist budget, which bounds a
 *   silent host without capping a healthy long transfer (see the note above).
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = {
    epg: 30_000,
    playlist: 30_000,
    stalker: 15_000,
    stalkerCreateLink: 30_000,
    xtream: 30_000,
} as const;

/** Status used for a fast-fail, matching `normalizeProviderError`'s upstream-unreachable answer. */
const HOST_UNREACHABLE_STATUS = 502;

export type HostRequestAdmission =
    | { readonly allowed: true; readonly token: HostRequestToken | null }
    | { readonly allowed: false; readonly error: NormalizedProviderError };

/**
 * Whether a request to `url` may go out.
 *
 * A refusal carries the ordinary `{ message, status }` provider-error body, so
 * every route keeps answering in the shape its client already parses. The
 * message itself is the shared one from `@iptvnator/shared/interfaces` — the
 * Stalker renderer classifies transport failures from message text alone, and
 * that wording is the only one it reads as "connection-level failure" rather
 * than as a status, a timeout or an auth problem.
 *
 * A URL with no usable host is admitted untracked: there is nothing to key on,
 * and refusing over it would be worse than letting the transport report the
 * real problem.
 */
export function admitProviderRequest(
    guard: HostConnectivityGuard,
    url: string
): HostRequestAdmission {
    const endpoint = portalEndpointKeyOf(url);
    if (!endpoint) {
        return { allowed: true, token: null };
    }

    const check = guard.check(endpoint);
    if (!check.allowed) {
        return {
            allowed: false,
            error: {
                message: buildHostConnectivityFastFailMessage(endpoint),
                status: HOST_UNREACHABLE_STATUS,
            },
        };
    }

    return { allowed: true, token: check.token };
}

/**
 * Gives a token back without recording anything about the host.
 *
 * For a request that was admitted and then abandoned before it went out — a URL
 * the SSRF policy refused, for instance. That says nothing about reachability,
 * so it must not count as a failure; but the slot a half-open trial reserved
 * has to be released. Every admitted route also calls this in finally, even
 * if outcome reporting throws; cleanup is idempotent and records no failure.
 */
export function releaseProviderRequest(
    guard: HostConnectivityGuard,
    token: HostRequestToken | null
): void {
    if (token) {
        guard.reportInconclusive(token);
    }
}

/** The host answered — whatever the status was, it is reachable. */
/**
 * The provider accepted the TCP connection — reachability evidence, reported
 * the moment the transport's `onConnect` fires rather than when the request
 * settles. A request that connects and then hangs must not, on its eventual
 * timeout, clear failures that later requests recorded in between.
 */
export function reportProviderRequestConnected(
    guard: HostConnectivityGuard,
    token: HostRequestToken | null
): void {
    if (token) {
        guard.reportConnected(token);
    }
}

export function reportProviderRequestSuccess(
    guard: HostConnectivityGuard,
    token: HostRequestToken | null
): void {
    if (token) {
        guard.reportSuccess(token);
    }
}

/**
 * A token for a request that must NOT be policed or counted, but whose success
 * still clears the record.
 *
 * Stalker endpoint discovery probes several candidate paths on one host and
 * expects most of them to fail; counting those would let it declare a
 * slow-but-alive portal unreachable, and fast-failing them would abandon a
 * portal mid-discovery. The probe does not take the half-open slot either — it
 * is not the trial the breaker is waiting for. Mirrors the Electron handler's
 * `skipConnectionGuard` path.
 */
export function observeProviderRequest(
    guard: HostConnectivityGuard,
    url: string
): HostRequestToken | null {
    const endpoint = portalEndpointKeyOf(url);
    return endpoint ? guard.observe(endpoint) : null;
}

/**
 * Forgets the failures recorded for the host `url` points at, so the next
 * request contacts it for real. Sent by the renderer whenever the user asked
 * for a genuine attempt (portal retry, "test connection") or handed over an
 * address that may now point somewhere else (import, edited connection, lazy
 * repair) — the counterpart of the Electron `CONNECTIVITY_GUARD_RESET` handler.
 *
 * Returns whether a host could be read from `url` at all.
 */
export function resetProviderHost(
    guard: HostConnectivityGuard,
    url: string
): boolean {
    const endpoint = portalEndpointKeyOf(url);
    if (!endpoint) {
        return false;
    }

    guard.reset(endpoint);
    return true;
}

/**
 * Records what a failed request proved about its endpoint.
 *
 * `requestUrl` is the URL the request was actually issued against. It is what
 * lets a failure on a redirect hop be told apart from a failure of the endpoint
 * we guarded: a provider that answers `302` towards a dead CDN is demonstrably
 * alive, and charging the destination's refusal to it would fast-fail a working
 * portal. Same rule and same helper as the Electron handlers.
 *
 * `countFailures: false` is for requests exempt from the guard (endpoint
 * discovery). Their failures are expected and must not count — but the report
 * must still happen, because an error that carries an HTTP response proves the
 * endpoint answered. The redirect wrapper accepts 3xx, but axios still rejects
 * other non-2xx WITH `error.response`; dropping those instead of reporting them is
 * what would let the breaker open in the middle of discovery.
 */
export function reportProviderRequestFailure(
    guard: HostConnectivityGuard,
    token: HostRequestToken | null,
    error: unknown,
    options: {
        countFailures?: boolean;
        requestUrl?: string;
        /**
         * The transport's word that the provider accepted the TCP connection
         * (`WebBackendHttpGetOptions.onConnect`). A timeout after that is a
         * slow provider, not a dead one, and does not count; the connection
         * itself was credited by `reportProviderRequestConnected` when it
         * happened — see `classifyHostRequestFailure`.
         */
        connected?: boolean;
    } = {}
): void {
    if (!token) {
        return;
    }

    const manualChain = error instanceof ProviderRequestError;
    if (error instanceof ProviderRequestError) {
        if (error.initialResponded) {
            guard.reportSuccess(token);
            return;
        }
        error = error.cause;
    }
    const countFailures = options.countFailures ?? true;
    // Redirect attribution is checked BEFORE the exemption and before the
    // connected rule, not after. A 3xx from the guarded endpoint is an answer,
    // and an exempt probe observing one has to clear the record just as it
    // does for any other response — otherwise an ordinary timeout, a probe
    // that was redirected to a dead destination, and another ordinary timeout
    // still read as two consecutive failures.
    if (
        !manualChain &&
        classifyHostRequestFailure(error) === 'host-level' &&
        failedAfterRedirect(error, token, options.requestUrl)
    ) {
        guard.reportSuccess(token);
        return;
    }
    switch (
        classifyHostRequestFailure(error, { connected: options.connected })
    ) {
        case 'host-level':
            if (!countFailures) {
                break;
            }
            guard.reportFailure(token);
            break;
        case 'responded':
            guard.reportSuccess(token);
            break;
        default:
            guard.reportInconclusive(token);
            break;
    }
}
