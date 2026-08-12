/**
 * Per-host circuit breaker for portal requests.
 *
 * A dead portal costs the full axios timeout on every call (30 s for Xtream,
 * 15 s for Stalker), and browsing a dead portal's catalog issues dozens of
 * those back to back — 30-second spinners and a flooded main-process log. Once
 * a host has refused to answer twice in a row there is nothing left to learn
 * from waiting again, so subsequent requests fail immediately for a short
 * while.
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
/** How long requests fast-fail once the breaker is open. */
const OPEN_DURATION_MS = 30_000;
/**
 * Failures further apart than this are unrelated, not a streak. Two sequential
 * 30 s timeouts must fit inside it, hence comfortably above 60 s.
 */
const FAILURE_WINDOW_MS = 120_000;
/**
 * Safety net for a half-open trial that never reports back. Above the longest
 * request timeout (30 s) plus margin, so it only fires if a caller leaked the
 * token — without it a lost report would keep the breaker open forever.
 */
const TRIAL_TIMEOUT_MS = 45_000;
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
    readonly host: string;

    constructor(host: string) {
        super(buildHostConnectivityFastFailMessage(host));
        this.name = 'HostConnectivityGuardError';
        this.host = host;
    }
}

/**
 * Handed out by {@link HostConnectivityGuard.check} and passed back when the
 * request settles. It records which attempt the report belongs to, so a reset
 * or a parallel sibling cannot be mistaken for fresh evidence.
 */
export interface HostRequestToken {
    readonly host: string;
    readonly epoch: number;
    readonly startedAt: number;
    /** Whether this request is the single probe allowed while half-open. */
    readonly trial: boolean;
}

export type HostConnectivityCheck =
    | { readonly allowed: true; readonly token: HostRequestToken }
    | { readonly allowed: false; readonly retryAfterMs: number };

export type HostRequestOutcome = 'responded' | 'host-level' | 'inconclusive';

interface HostState {
    consecutiveFailures: number;
    /** When the last COUNTED failure was recorded. */
    lastFailureAt: number;
    openUntil: number;
    trialStartedAt: number | null;
    epoch: number;
    lastTouchedAt: number;
}

export interface HostConnectivityGuardOptions {
    now?: () => number;
    onOpen?: (host: string) => void;
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

/** Extracts the guard key (host and port) from a request URL. */
export function hostKeyOf(url: string): string | null {
    try {
        return new URL(url).host || null;
    } catch {
        return null;
    }
}

export class HostConnectivityGuard {
    private readonly states = new Map<string, HostState>();
    private readonly now: () => number;
    private readonly onOpen?: (host: string) => void;

    constructor(options: HostConnectivityGuardOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.onOpen = options.onOpen;
    }

    /**
     * Whether a request to `host` may go out, and the token to report with.
     *
     * Fast-fails while the breaker is open, and while a half-open trial is
     * still in flight — the point of the trial is that a screenful of requests
     * does not all hang again to learn the same thing.
     */
    check(host: string): HostConnectivityCheck {
        const now = this.now();
        if (isHostConnectivityGuardDisabled()) {
            return {
                allowed: true,
                token: { host, epoch: 0, startedAt: now, trial: false },
            };
        }

        const state = this.ensureState(host, now);
        state.lastTouchedAt = now;

        if (state.openUntil > now) {
            return { allowed: false, retryAfterMs: state.openUntil - now };
        }

        // Never opened, or the open window elapsed. The latter is half-open:
        // let one request through and hold the rest back until it settles.
        let trial = false;
        if (state.openUntil > 0) {
            const trialStale =
                state.trialStartedAt !== null &&
                now - state.trialStartedAt >= TRIAL_TIMEOUT_MS;
            if (state.trialStartedAt !== null && !trialStale) {
                return { allowed: false, retryAfterMs: 0 };
            }
            state.trialStartedAt = now;
            trial = true;
        }

        return {
            allowed: true,
            token: { host, epoch: state.epoch, startedAt: now, trial },
        };
    }

    /**
     * The host answered. Always clears the record, whatever the status was and
     * whichever attempt it belonged to — a reachable host is a reachable host.
     */
    reportSuccess(token: HostRequestToken): void {
        const state = this.states.get(token.host);
        if (!state || isHostConnectivityGuardDisabled()) {
            return;
        }

        state.consecutiveFailures = 0;
        state.lastFailureAt = 0;
        state.openUntil = 0;
        state.trialStartedAt = null;
        state.lastTouchedAt = this.now();
    }

    /** The host did not answer at all. */
    reportFailure(token: HostRequestToken): void {
        const state = this.states.get(token.host);
        if (!state || isHostConnectivityGuardDisabled()) {
            return;
        }

        const now = this.now();
        // Superseded by an explicit reset: the user asked for a fresh attempt
        // and this verdict predates it.
        if (state.epoch !== token.epoch) {
            this.releaseTrial(state, token);
            return;
        }

        const wasTrial = token.trial && state.trialStartedAt !== null;
        if (token.trial) {
            state.trialStartedAt = null;
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
        // of them is one piece of evidence, not a trip. A request that started
        // at or after that moment is a genuine new attempt.
        if (
            state.consecutiveFailures === 0 ||
            token.startedAt >= state.lastFailureAt
        ) {
            state.consecutiveFailures += 1;
            state.lastFailureAt = now;
        }

        // A failed trial goes straight back to open: the host had its chance.
        if (wasTrial || state.consecutiveFailures >= FAILURE_THRESHOLD) {
            const wasOpen = state.openUntil > now;
            state.openUntil = now + OPEN_DURATION_MS;
            if (!wasOpen) {
                this.onOpen?.(token.host);
            }
        }
    }

    /**
     * The request failed for a reason that says nothing about the host. Only
     * releases the half-open slot, so the next request can be the trial.
     */
    reportInconclusive(token: HostRequestToken): void {
        const state = this.states.get(token.host);
        if (!state || isHostConnectivityGuardDisabled()) {
            return;
        }

        this.releaseTrial(state, token);
        state.lastTouchedAt = this.now();
    }

    /**
     * Forgets everything recorded for `host`, and invalidates the reports of
     * requests already in flight. Called when the user asks for a real attempt
     * or when the URL may now point somewhere else.
     */
    reset(host: string): void {
        const now = this.now();
        const state = this.ensureState(host, now);
        state.consecutiveFailures = 0;
        state.lastFailureAt = 0;
        state.openUntil = 0;
        state.trialStartedAt = null;
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
    observe(host: string): HostRequestToken {
        return {
            host,
            epoch: this.states.get(host)?.epoch ?? 0,
            startedAt: this.now(),
            trial: false,
        };
    }

    /** Test seam: drops all recorded state. */
    clear(): void {
        this.states.clear();
    }

    private releaseTrial(state: HostState, token: HostRequestToken): void {
        if (token.trial && state.epoch === token.epoch) {
            state.trialStartedAt = null;
        }
    }

    private ensureState(host: string, now: number): HostState {
        const existing = this.states.get(host);
        if (existing) {
            return existing;
        }

        this.prune(now);
        const state: HostState = {
            consecutiveFailures: 0,
            lastFailureAt: 0,
            openUntil: 0,
            trialStartedAt: null,
            epoch: 0,
            lastTouchedAt: now,
        };
        this.states.set(host, state);
        return state;
    }

    private prune(now: number): void {
        for (const [host, state] of this.states) {
            if (
                now - state.lastTouchedAt > IDLE_TTL_MS &&
                state.openUntil <= now &&
                state.trialStartedAt === null
            ) {
                this.states.delete(host);
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

let sharedGuard: HostConnectivityGuard | null = null;

/** The guard both portal IPC handlers share. */
export function getHostConnectivityGuard(): HostConnectivityGuard {
    if (!sharedGuard) {
        sharedGuard = new HostConnectivityGuard({
            onOpen: (host) =>
                console.warn(
                    `[HostConnectivityGuard] ${host} is not answering; skipping requests to it for ${
                        OPEN_DURATION_MS / 1000
                    }s`
                ),
        });
    }
    return sharedGuard;
}

/** Test seam: forgets the shared guard so each spec starts clean. */
export function resetHostConnectivityGuardForTests(): void {
    sharedGuard = null;
}

/**
 * Reserves a slot for a request to `url` on the shared guard.
 *
 * Throws {@link HostConnectivityGuardError} instead of letting the request hang
 * again while the breaker is open. Returns `null` for a URL with no usable
 * host — there is nothing to track then, and refusing the request over that
 * would be worse than letting the transport report the real problem.
 */
export function beginGuardedHostRequest(url: string): HostRequestToken | null {
    const host = hostKeyOf(url);
    if (!host) {
        return null;
    }

    const check = getHostConnectivityGuard().check(host);
    if (!check.allowed) {
        throw new HostConnectivityGuardError(host);
    }

    return check.token;
}

/** Untracked counterpart of {@link beginGuardedHostRequest}, see `observe`. */
export function observeGuardedHostRequest(
    url: string
): HostRequestToken | null {
    const host = hostKeyOf(url);
    return host ? getHostConnectivityGuard().observe(host) : null;
}

export function reportGuardedHostSuccess(
    token: HostRequestToken | null
): void {
    if (token) {
        getHostConnectivityGuard().reportSuccess(token);
    }
}

export function reportGuardedHostFailure(
    token: HostRequestToken | null,
    error: unknown
): void {
    if (!token) {
        return;
    }

    const guard = getHostConnectivityGuard();
    switch (classifyHostRequestFailure(error)) {
        case 'host-level':
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

/** Forgets the recorded failures for the host `url` points at. */
export function resetGuardedHost(url: string): boolean {
    const host = hostKeyOf(url);
    if (!host) {
        return false;
    }

    getHostConnectivityGuard().reset(host);
    return true;
}
