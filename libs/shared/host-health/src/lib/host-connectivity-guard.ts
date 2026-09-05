/**
 * Per-host circuit breaker for portal requests.
 *
 * Shared by the two processes that talk to portals on the user's behalf: the
 * Electron main process and the self-hosted web backend. Neither the class nor
 * anything below it reaches for a transport, a logger or a process singleton —
 * the owning app supplies the clock and decides how many guards exist, which is
 * what lets the web backend hand its Express app a per-instance guard in tests.
 *
 * A dead portal costs the full axios timeout on every call (30 s for Xtream,
 * 15 s for Stalker), and browsing a dead portal's catalog issues dozens of
 * those back to back — 30-second spinners and a flooded log. Once a host has
 * refused to answer twice in a row there is nothing left to learn from waiting
 * again, so subsequent requests fail immediately for a short while.
 *
 * The rules are deliberately timid, because being wrong here means refusing to
 * talk to a portal that works:
 *
 * - Only connection-level evidence counts (see
 *   {@link classifyHostRequestFailure}). Any HTTP response — 200, 404, even
 *   502 — proves the host is alive and clears the record.
 * - The window is short (30 s), so a mistake costs one page of navigation, and
 *   a host that came back is retried on its own.
 * - Half-open means exactly ONE request goes out, not a whole screenful.
 * - An explicit reset (user retry, endpoint discovery) always wins, and
 *   failures from requests that started before it are discarded — otherwise a
 *   30-second straggler settles right after the reset and re-opens the breaker
 *   underneath the retry that cleared it.
 *
 * Deliberately not persisted: process lifetime is the right scope for
 * "unreachable right now".
 */

import { buildHostConnectivityFastFailMessage } from '@iptvnator/shared/interfaces';

/** Consecutive connection failures that trip the breaker. */
const FAILURE_THRESHOLD = 2;
/**
 * How long requests fast-fail once the breaker is open. Exported because both
 * apps say it out loud in their "skipping requests for Ns" log line, and a
 * second copy of the number would drift from this one.
 */
export const OPEN_DURATION_MS = 30_000;
/**
 * Failures further apart than this are unrelated, not a streak. Two sequential
 * 30 s timeouts must fit inside it, hence comfortably above 60 s.
 */
const FAILURE_WINDOW_MS = 120_000;
/** Hosts tracked at once; portals per user are few, this is just a bound. */
const MAX_TRACKED_HOSTS = 256;
/** Idle records are forgotten; they hold nothing worth remembering. */
const IDLE_TTL_MS = 600_000;

const GUARD_DISABLED_ENV = 'IPTVNATOR_DISABLE_CONNECTIVITY_GUARD';

/**
 * Error codes that prove the host itself did not answer.
 *
 * `ECONNRESET` is deliberately absent: a reset mid-transfer happens on hosts
 * that are very much alive, and it is the one code a working stream can emit.
 */
const HOST_LEVEL_FAILURE_CODES = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
]);

/**
 * Thrown instead of making a request while the breaker is open.
 *
 * A real `Error`, because Electron serializes a rejected plain object to
 * `[object Object]` and the renderer's classification would be lost. It
 * carries NO `status` property on purpose — `getStalkerRequestErrorStatus`
 * reads that field first, and a numeric status there would read as "the
 * endpoint answered".
 */
export class HostConnectivityGuardError extends Error {
    /** Scheme, host and port — see {@link portalEndpointKeyOf}. */
    readonly endpoint: string;

    constructor(endpoint: string) {
        super(buildHostConnectivityFastFailMessage(endpoint));
        this.name = 'HostConnectivityGuardError';
        this.endpoint = endpoint;
    }
}

/**
 * Handed out by {@link HostConnectivityGuard.check} and passed back when the
 * request settles. It records which attempt the report belongs to, so a reset
 * or a parallel sibling cannot be mistaken for fresh evidence.
 */
export interface HostRequestToken {
    /** Scheme, host and port — see {@link portalEndpointKeyOf}. */
    readonly endpoint: string;
    readonly epoch: number;
    /** Admission order within this guard, independent of clock precision. */
    readonly admissionId: number;
    /** Whether this request is the single probe allowed while half-open. */
    readonly trial: boolean;
    /**
     * Which half-open slot this request holds, when it holds one.
     *
     * Cleanup from a released owner can arrive after another trial has been
     * admitted. Only this identity (plus epoch) may release the current slot.
     */
    readonly trialId: number;
}

export type HostConnectivityCheck =
    | { readonly allowed: true; readonly token: HostRequestToken }
    | { readonly allowed: false; readonly retryAfterMs: number };

export type HostRequestOutcome = 'responded' | 'host-level' | 'inconclusive';

interface HostState {
    consecutiveFailures: number;
    /** When the last COUNTED failure was recorded. */
    lastFailureAt: number;
    /** Latest guard-wide admission id when this host's last failure counted. */
    lastFailureAdmissionId: number;
    openUntil: number;
    trialInFlight: boolean;
    /** Monotonic id of the half-open slot; see `HostRequestToken.trialId`. */
    trialId: number;
    epoch: number;
    lastTouchedAt: number;
}

export interface HostConnectivityGuardOptions {
    now?: () => number;
    onOpen?: (endpoint: string) => void;
}

/**
 * Whether the guard is switched off. Read at call time, not at module load, so
 * a debugging session can toggle it (matches `IPTVNATOR_ALLOW_INSECURE_TLS`).
 */
export function isHostConnectivityGuardDisabled(): boolean {
    const value = process.env[GUARD_DISABLED_ENV]?.trim().toLowerCase();
    return value === '1' || value === 'true';
}

/**
 * What a failed request proves about the host.
 *
 * `responded` covers an error that still carries an HTTP response (5xx reaches
 * the handlers as a rejection because `validateStatus` only tolerates <500) —
 * the host is alive, so it clears the record. `inconclusive` covers everything
 * that says nothing about reachability: a cancelled request, a URL rejected by
 * the SSRF policy, a bug in our own code.
 */
export function classifyHostRequestFailure(error: unknown): HostRequestOutcome {
    if (!error || typeof error !== 'object') {
        return 'inconclusive';
    }

    if ((error as { response?: unknown }).response) {
        return 'responded';
    }

    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && HOST_LEVEL_FAILURE_CODES.has(code)) {
        return 'host-level';
    }

    return 'inconclusive';
}

/**
 * The guard key for a request URL: its ORIGIN, i.e. scheme, host and port.
 *
 * Not `URL.host`, which omits a default port and therefore gives
 * `http://panel.example` and `https://panel.example` the same key — two
 * genuinely different endpoints, and a panel whose TLS listener is broken while
 * plain HTTP works is a routine IPTV setup. Sharing one record there would let
 * the dead one fast-fail the working one without ever contacting it.
 *
 * `URL.origin` also leaves out any `user:pass@` userinfo, so no credential
 * reaches the key or the log line.
 */
export function portalEndpointKeyOf(url: string): string | null {
    try {
        const origin = new URL(url).origin;
        // Opaque origins serialize as "null" and are not a usable key.
        return origin && origin !== 'null' ? origin : null;
    } catch {
        return null;
    }
}

export class HostConnectivityGuard {
    private readonly states = new Map<string, HostState>();
    /** Never reused when an endpoint is evicted while requests are in flight. */
    private admissionId = 0;
    private readonly now: () => number;
    private readonly onOpen?: (endpoint: string) => void;

    constructor(options: HostConnectivityGuardOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.onOpen = options.onOpen;
    }

    /**
     * Whether a request to `endpoint` may go out, and the token to report with.
     *
     * Fast-fails while the breaker is open, and while a half-open trial is
     * still in flight — the point of the trial is that a screenful of requests
     * does not all hang again to learn the same thing.
     */
    check(endpoint: string): HostConnectivityCheck {
        const now = this.now();
        if (isHostConnectivityGuardDisabled()) {
            return {
                allowed: true,
                token: {
                    endpoint,
                    epoch: 0,
                    admissionId: 0,
                    trial: false,
                    trialId: 0,
                },
            };
        }

        const state = this.ensureState(endpoint, now);
        state.lastTouchedAt = now;

        if (state.openUntil > now) {
            return { allowed: false, retryAfterMs: state.openUntil - now };
        }

        // Never opened, or the open window elapsed. The latter is half-open:
        // let one request through and hold the rest back until it settles.
        let trial = false;
        if (state.openUntil > 0) {
            if (state.trialInFlight) {
                return { allowed: false, retryAfterMs: 0 };
            }
            state.trialInFlight = true;
            state.trialId += 1;
            trial = true;
        }

        return {
            allowed: true,
            token: {
                endpoint,
                epoch: state.epoch,
                admissionId: ++this.admissionId,
                trial,
                trialId: trial ? state.trialId : 0,
            },
        };
    }

    /**
     * The host answered. Always clears the record, whatever the status was and
     * whichever attempt it belonged to — a reachable host is a reachable host.
     */
    reportSuccess(token: HostRequestToken): void {
        const state = this.states.get(token.endpoint);
        if (!state) {
            return;
        }
        if (isHostConnectivityGuardDisabled()) {
            this.releaseTrial(state, token);
            return;
        }

        state.consecutiveFailures = 0;
        state.lastFailureAt = 0;
        state.openUntil = 0;
        state.trialInFlight = false;
        state.lastTouchedAt = this.now();
    }

    /** The host did not answer at all. */
    reportFailure(token: HostRequestToken): void {
        const state = this.states.get(token.endpoint);
        if (!state) {
            return;
        }
        if (isHostConnectivityGuardDisabled()) {
            this.releaseTrial(state, token);
            return;
        }

        const now = this.now();
        // Superseded by an explicit reset: the user asked for a fresh attempt
        // and this verdict predates it.
        if (state.epoch !== token.epoch) {
            this.releaseTrial(state, token);
            return;
        }

        // Only the request that still holds the slot ends the half-open state.
        // An abandoned trial's late failure is ordinary evidence — it goes
        // through the streak rules below and leaves the replacement alone.
        const wasTrial = this.ownsTrial(state, token);
        if (wasTrial) {
            state.trialInFlight = false;
        }
        state.lastTouchedAt = now;

        if (
            state.consecutiveFailures > 0 &&
            now - state.lastFailureAt > FAILURE_WINDOW_MS
        ) {
            state.consecutiveFailures = 0;
        }

        // A request already in flight when the previous failure was recorded is
        // not the next link in a streak — it is a sibling of it. Catalog
        // loading fans out several requests at once, and one hiccup failing all
        // of them is one piece of evidence, not a trip. Admission order makes
        // that boundary exact even when all events share one clock tick.
        let counted = false;
        if (
            state.consecutiveFailures === 0 ||
            token.admissionId > state.lastFailureAdmissionId
        ) {
            state.consecutiveFailures += 1;
            state.lastFailureAt = now;
            state.lastFailureAdmissionId = this.admissionId;
            counted = true;
        }

        // Only a failure this report actually counted may trip the threshold.
        // A sibling arriving after the window elapsed would otherwise open a
        // fresh one off the existing count, pushing the half-open trial past
        // the intended cooldown. A failed trial still goes straight back to
        // open: the host had its chance.
        if (
            wasTrial ||
            (counted && state.consecutiveFailures >= FAILURE_THRESHOLD)
        ) {
            const wasOpen = state.openUntil > now;
            state.openUntil = now + OPEN_DURATION_MS;
            if (!wasOpen) {
                this.onOpen?.(token.endpoint);
            }
        }
    }

    /**
     * The request failed for a reason that says nothing about the host. Only
     * releases the half-open slot, so the next request can be the trial.
     * Owners MUST also call this in finally, independently of outcome reporting.
     * It is idempotent and still releases while the guard is disabled by the environment;
     * no elapsed-time expiry can distinguish a leak from an active transfer.
     */
    reportInconclusive(token: HostRequestToken): void {
        const state = this.states.get(token.endpoint);
        if (!state) {
            return;
        }

        this.releaseTrial(state, token);
        state.lastTouchedAt = this.now();
    }

    /**
     * Forgets everything recorded for `endpoint`, and invalidates the reports of
     * requests already in flight. Called when the user asks for a real attempt
     * or when the URL may now point somewhere else.
     */
    reset(endpoint: string): void {
        const now = this.now();
        const state = this.ensureState(endpoint, now);
        state.consecutiveFailures = 0;
        state.lastFailureAt = 0;
        state.openUntil = 0;
        state.trialInFlight = false;
        state.epoch += 1;
        state.lastTouchedAt = now;
    }

    /**
     * A token for a request that must NOT be policed or counted, but whose
     * success still clears the record.
     *
     * Stalker endpoint discovery probes several candidate paths on one host and
     * expects most of them to fail; counting those would let it declare a
     * slow-but-alive portal unreachable. It does not take the half-open slot
     * either — a probe is not the trial the guard is waiting for.
     */
    observe(endpoint: string): HostRequestToken {
        return {
            endpoint,
            epoch: this.states.get(endpoint)?.epoch ?? 0,
            admissionId: 0,
            trial: false,
            trialId: 0,
        };
    }

    /** Test seam: drops all recorded state. */
    clear(): void {
        this.states.clear();
    }

    /** Whether `token` still holds the current half-open slot. */
    private ownsTrial(state: HostState, token: HostRequestToken): boolean {
        return (
            token.trial &&
            state.trialInFlight &&
            state.epoch === token.epoch &&
            state.trialId === token.trialId
        );
    }

    private releaseTrial(state: HostState, token: HostRequestToken): void {
        if (this.ownsTrial(state, token)) {
            state.trialInFlight = false;
        }
    }

    private ensureState(endpoint: string, now: number): HostState {
        const existing = this.states.get(endpoint);
        if (existing) {
            return existing;
        }

        this.prune(now);
        const state: HostState = {
            consecutiveFailures: 0,
            lastFailureAt: 0,
            lastFailureAdmissionId: 0,
            openUntil: 0,
            trialInFlight: false,
            trialId: 0,
            epoch: 0,
            lastTouchedAt: now,
        };
        this.states.set(endpoint, state);
        return state;
    }

    private prune(now: number): void {
        for (const [endpoint, state] of this.states) {
            if (
                now - state.lastTouchedAt > IDLE_TTL_MS &&
                state.openUntil <= now &&
                !state.trialInFlight
            ) {
                this.states.delete(endpoint);
            }
        }

        // Still at the cap: forget the oldest records. Dropping one means
        // contacting that host again, which is the safe direction to err in.
        while (this.states.size >= MAX_TRACKED_HOSTS) {
            const oldest = this.states.keys().next();
            if (oldest.done) {
                return;
            }
            this.states.delete(oldest.value);
        }
    }
}

/**
 * The URL a failed request was actually talking to, when the error says.
 *
 * Redirects are followed hop by hop, each with its own config, so a failure on
 * a later hop carries THAT hop's URL rather than the one we asked for.
 */
function failedRequestUrlOf(error: unknown): string | null {
    // Two transports, two places to look, and only one of them is ever right.
    //
    // The Electron transport follows redirects itself with `maxRedirects: 0`,
    // reissuing each hop as its own request, so the hop that failed is the
    // error's `config.url`.
    //
    // The web backend uses axios' default transport, where follow-redirects
    // walks the chain inside a single request. `config` is built once and never
    // rewritten, so `config.url` stays the URL we asked for — comparing it
    // against itself would find no redirect and charge a dead destination to
    // the provider that answered. follow-redirects tracks the hop it is on as
    // `request._currentUrl`, so that is read first; a transport that does not
    // expose it falls through to `config.url`.
    const currentUrl = (
        error as { request?: { _currentUrl?: unknown } | null } | null
    )?.request?._currentUrl;
    if (typeof currentUrl === 'string') {
        return currentUrl;
    }

    const url = (error as { config?: { url?: unknown } } | null)?.config?.url;
    return typeof url === 'string' ? url : null;
}

/**
 * Origin and path only — deliberately without the query string.
 *
 * The baseline a caller can supply is the URL it handed the transport, but the
 * transport is free to add to the query before sending: the web backend passes
 * Xtream credentials through axios' `params`, so a request for
 * `…/player_api.php` goes out as `…/player_api.php?username=…&action=…`.
 * Comparing whole URLs then reports a redirect for every ordinary failure,
 * which credits the endpoint instead of counting it and stops the breaker from
 * ever opening.
 *
 * Dropping the query keeps what the comparison is actually for — an endpoint
 * that answered and sent us somewhere else, including the same-origin
 * `/player_api.php` → `/slow/player_api.php` case — and gives up only a
 * redirect that changes nothing but the query. That one is then counted as an
 * ordinary failure, which is the safe direction to be wrong in.
 */
function normalizedUrlOrNull(url: string): string | null {
    try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return null;
    }
}

/**
 * Whether the failure happened on a hop the guarded endpoint redirected us to.
 *
 * Reaching any later hop proves the guarded endpoint answered: the first hop is
 * always the URL we asked for, and only a redirect status advances the chain.
 * That holds for a same-origin redirect too, so comparing the whole URL — not
 * just its origin — is what catches `/player_api.php` → `/slow/player_api.php`.
 *
 * Requires positive evidence: anything unparseable or unknown returns false and
 * the failure is counted as usual, because guessing "redirect" here would stop
 * the guard from ever tripping.
 */
export function failedAfterRedirect(
    error: unknown,
    token: HostRequestToken,
    requestUrl: string | undefined
): boolean {
    const failedUrl = failedRequestUrlOf(error);
    if (!failedUrl) {
        return false;
    }

    const failedEndpoint = portalEndpointKeyOf(failedUrl);
    if (failedEndpoint && failedEndpoint !== token.endpoint) {
        return true;
    }

    if (!requestUrl) {
        return false;
    }

    const failedNormalized = normalizedUrlOrNull(failedUrl);
    const requestedNormalized = normalizedUrlOrNull(requestUrl);
    return (
        failedNormalized !== null &&
        requestedNormalized !== null &&
        failedNormalized !== requestedNormalized
    );
}
