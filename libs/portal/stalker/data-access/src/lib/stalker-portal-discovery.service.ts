import { Injectable, inject } from '@angular/core';
import { DataService } from '@iptvnator/services';
import { STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    StalkerPortalCredentials,
    StalkerProfileResponse,
    StalkerSessionService,
} from './stalker-session.service';
import { type StalkerPortalIdentity } from './stalker-identity.utils';
import {
    buildStalkerEndpointCandidates,
    classifyStalkerProbeResponse,
    getStalkerRequestErrorStatus,
    isStalkerAuthFailureResponse,
    isStalkerProbeTimeout,
} from './stalker-portal-discovery.utils';

/** A candidate endpoint answered and its auth behavior was observed. */
export interface StalkerPortalEndpointResolution {
    status: 'resolved';
    /** The endpoint that actually answered content requests. */
    portalUrl: string;
    /** Observed behavior: true when the endpoint enforces the Bearer token. */
    isFullStalkerPortal: boolean;
    /** Session token from the classification handshake (full portals only). */
    token?: string;
    /** Account block from the classification `get_profile` (full portals only). */
    accountInfo?: StalkerProfileResponse['js']['account_info'];
    /**
     * Watchdog cadence the confirming `get_profile` advertised. Persisted at
     * import because a later start reuses the token and skips the only
     * response that carries it.
     */
    watchdogTimeoutSeconds?: number;
    timeslotSeconds?: number;
}

/**
 * An endpoint exists and demands authentication, but the handshake/profile
 * flow was refused — wrong MAC, blocked account, or a panel we cannot
 * authenticate against. Nothing may be persisted from this outcome.
 */
export interface StalkerPortalDiscoveryRejection {
    status: 'auth-rejected';
    portalUrl: string;
    error?: unknown;
    /**
     * The abandoned attempt was STILL in flight when the drain deadline
     * expired, so discovery must not advance. Cancellation is cooperative —
     * neither transport can pull a request off the wire (the PWA `fetch()`
     * takes no signal, and the Electron main process runs its HTTP request to
     * completion) — so an attempt this far past its deadline may still land a
     * `get_profile`, which adopts the MAC's token portal-side and would
     * invalidate the session a later candidate had just established.
     */
    abandonedInFlight?: boolean;
    /**
     * Resolves once the abandoned authentication has actually left the
     * transport. Callers that reserve the playlist during discovery must
     * keep that reservation until this resolves: returning the user-facing
     * rejection is bounded, but the request on the wire is not.
     */
    abandonedAuthenticationSettled?: Promise<void>;
}

/** No candidate answered like a Stalker portal (host down or not a portal). */
export interface StalkerPortalDiscoveryUnreachable {
    status: 'unreachable';
}

export type StalkerPortalDiscoveryOutcome =
    | StalkerPortalEndpointResolution
    | StalkerPortalDiscoveryRejection
    | StalkerPortalDiscoveryUnreachable;

/** Per-request guard so a hanging host cannot stall discovery forever. */
const PROBE_TIMEOUT_MS = 20_000;
/**
 * `authenticate()` is up to FOUR sequential requests once a portal answers
 * `get_profile` with status 2 — handshake, profile, `do_auth`, profile retry —
 * and the Electron transport allows each non-`create_link` call 15 s. A budget
 * that only covered two would abort a valid but slow login-required portal
 * before its final profile and report it as `auth-rejected`.
 */
const AUTH_TIMEOUT_MS = 4 * 15_000 + 5_000;

/**
 * How long to wait for an abandoned attempt to settle before probing the next
 * candidate.
 *
 * Aborting cannot un-send a request: if its `get_profile` was already
 * dispatched, the portal adopts that token regardless of what the client does
 * to its socket. What we CAN do is refuse to race it — advancing while it is
 * still in flight is what lets it invalidate the token the next candidate
 * negotiates. Bounded by one request budget so a genuinely hung host cannot
 * stall discovery forever; past that the risk is accepted rather than hanging.
 */
const ABANDONED_DRAIN_MS = 15_000;

function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            // Abandon the underlying operation BEFORE advancing: the timer
            // only rejects this wrapper, and a late `get_profile` would adopt
            // the MAC's token portal-side, invalidating whatever the next
            // candidate just negotiated.
            onTimeout?.();
            reject(new Error('Stalker portal probe timed out'));
        }, timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/**
 * Resolves which API endpoint a Stalker portal actually answers on and
 * whether it enforces the full auth lifecycle — by probing, not by URL
 * shape. Used at import time and by the lazy repair of previously
 * misclassified playlists.
 */
@Injectable({ providedIn: 'root' })
export class StalkerPortalDiscoveryService {
    private readonly dataService = inject(DataService);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly logger = createLogger('StalkerPortalDiscovery');

    /**
     * Probes candidate endpoints in order and classifies the first one that
     * answers. Per candidate: a token-less content request that returns real
     * data proves a token-free panel; the middleware's plain-text auth
     * failure proves the endpoint exists and enforces the token, which is
     * then confirmed by attempting the real handshake + `get_profile` flow.
     */
    async discover(
        rawUrl: string,
        macAddress: string,
        identity: StalkerPortalIdentity = {},
        options: { credentials?: StalkerPortalCredentials } = {}
    ): Promise<StalkerPortalDiscoveryOutcome> {
        const candidates = buildStalkerEndpointCandidates(rawUrl);
        let authRejection: StalkerPortalDiscoveryRejection | null = null;

        for (const candidate of candidates) {
            let probeResponse: unknown;
            try {
                probeResponse = await this.probeContent(candidate, macAddress);
            } catch (error) {
                const status = getStalkerRequestErrorStatus(error);
                if (status === 401 || status === 403) {
                    // The endpoint exists but sits behind an HTTP auth gate —
                    // non-standard middlewares answer 401/403 where the stock
                    // server answers 200 + plain text. Attempt the real
                    // handshake instead of skipping a valid candidate.
                    const outcome = await this.confirmFullPortal(
                        candidate,
                        macAddress,
                        identity,
                        options.credentials
                    );
                    if (outcome.status === 'resolved') {
                        return outcome;
                    }
                    if (outcome.abandonedInFlight) {
                        // This attempt's transport lifetime must reach the
                        // caller. Returning an earlier ordinary refusal would
                        // hide the live request and let Edit release its fence.
                        return outcome;
                    }
                    authRejection = authRejection ?? outcome;
                    continue;
                }
                if (status !== undefined) {
                    // Any resolvable HTTP status proves the HOST answered:
                    // 4xx means this endpoint is absent, and a 5xx here can
                    // be one broken handler (a dead /portal.php) while a
                    // sibling candidate works — keep probing either way.
                    continue;
                }
                if (isStalkerProbeTimeout(error)) {
                    // A timeout can also be one hanging handler with healthy
                    // siblings; each further candidate stays bounded by its
                    // own probe budget.
                    this.logger.warn(
                        'Stalker portal probe timed out; trying the next candidate'
                    );
                    continue;
                }
                // Connection-level failure (refused, unresolvable host):
                // every candidate lives on the same host, so further probing
                // cannot succeed either.
                this.logger.warn(
                    'Stalker portal probe failed at network level; stopping discovery'
                );
                return authRejection ?? { status: 'unreachable' };
            }

            switch (classifyStalkerProbeResponse(probeResponse)) {
                case 'data':
                    return {
                        status: 'resolved',
                        portalUrl: candidate,
                        isFullStalkerPortal: false,
                    };
                case 'auth-required': {
                    const outcome = await this.confirmFullPortal(
                        candidate,
                        macAddress,
                        identity,
                        options.credentials
                    );
                    if (outcome.status === 'resolved') {
                        return outcome;
                    }
                    // An attempt still on the wire outranks further probing:
                    // see `abandonedInFlight`.
                    if (outcome.abandonedInFlight) {
                        return outcome;
                    }
                    // The endpoint is real but refused our credentials;
                    // remember the first such endpoint in case no later
                    // candidate resolves.
                    authRejection = authRejection ?? outcome;
                    continue;
                }
                case 'not-a-portal':
                    continue;
            }
        }

        return authRejection ?? { status: 'unreachable' };
    }

    /**
     * Confirms a token-enforcing endpoint by running the real handshake +
     * `get_profile` flow against it.
     */
    private async confirmFullPortal(
        candidate: string,
        macAddress: string,
        identity: StalkerPortalIdentity,
        credentials?: StalkerPortalCredentials
    ): Promise<
        StalkerPortalEndpointResolution | StalkerPortalDiscoveryRejection
    > {
        // Cooperative cancellation: `authenticate()` checks this before each
        // portal call, so a timed-out attempt never sends the `get_profile`
        // that would adopt the MAC's token behind the next candidate's back.
        const abandon = new AbortController();
        // Kept so a timed-out attempt can be drained rather than raced.
        const pending = this.stalkerSession.authenticate(
            candidate,
            macAddress,
            identity,
            { credentials, signal: abandon.signal }
        );
        try {
            const auth = await withTimeout(pending, AUTH_TIMEOUT_MS, () =>
                abandon.abort()
            );
            // A handshake can hand out a token whose `get_profile` still
            // answers a structured denial (`{js:{error:'Invalid token'}}`);
            // `authenticate()` only inspects `msg`/`block_msg`, so reporting
            // `resolved` here would persist an unusable endpoint and stop
            // before a healthy sibling is probed.
            if (isStalkerAuthFailureResponse(auth.profileResponse)) {
                return {
                    status: 'auth-rejected',
                    portalUrl: candidate,
                    error: auth.profileResponse,
                };
            }
            return {
                status: 'resolved',
                portalUrl: candidate,
                isFullStalkerPortal: true,
                token: auth.token,
                accountInfo: auth.accountInfo,
                watchdogTimeoutSeconds: auth.watchdogTimeoutSeconds,
                timeslotSeconds: auth.timeslotSeconds,
            };
        } catch (error) {
            // Do not advance while the abandoned attempt may still be on the
            // wire: its `get_profile` adopts the MAC's token portal-side, so
            // racing it is exactly what invalidates the next candidate's
            // freshly issued session.
            //
            // Draining is the normal case and usually returns at once — an
            // aborted attempt settles as soon as its in-flight request errors
            // out. The deadline exists for the attempt that does not settle,
            // and reaching it is reported rather than swallowed: continuing
            // would stake a working candidate's session on a request nobody
            // can recall.
            const DRAINED = Symbol('drained');
            const abandonedAuthenticationSettled = pending.then(
                () => undefined,
                () => undefined
            );
            const outcome = await Promise.race([
                abandonedAuthenticationSettled.then(() => DRAINED),
                new Promise<undefined>((resolve) =>
                    setTimeout(resolve, ABANDONED_DRAIN_MS)
                ),
            ]);
            if (outcome !== DRAINED) {
                this.logger.warn(
                    'Abandoned Stalker authentication is still in flight after the drain deadline; stopping discovery rather than racing it'
                );
            }
            return {
                status: 'auth-rejected',
                portalUrl: candidate,
                error,
                ...(outcome === DRAINED
                    ? {}
                    : {
                          abandonedInFlight: true,
                          abandonedAuthenticationSettled,
                      }),
            };
        }
    }

    /**
     * Token-less, read-only content request (`itv/get_genres`) — the
     * cheapest action every Stalker-compatible panel implements and the
     * canonical middleware gates behind the Bearer token.
     */
    private probeContent(url: string, macAddress: string): Promise<unknown> {
        return withTimeout(
            Promise.resolve(
                this.dataService.sendIpcEvent<unknown>(STALKER_REQUEST, {
                    url,
                    macAddress,
                    params: {
                        type: 'itv',
                        action: 'get_genres',
                        JsHttpRequest: '1-xml',
                    },
                    // Probing absent endpoints fails BY DESIGN — the
                    // transport services skip their error snackbar for us.
                    silent: true,
                })
            ),
            PROBE_TIMEOUT_MS
        );
    }
}
