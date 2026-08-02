import { Injectable, inject } from '@angular/core';
import { DataService } from '@iptvnator/services';
import { STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
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
/** authenticate() is two sequential requests; give it a matching budget. */
const AUTH_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Stalker portal probe timed out')),
            timeoutMs
        );
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
        identity: StalkerPortalIdentity = {}
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
                        identity
                    );
                    if (outcome.status === 'resolved') {
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
                        identity
                    );
                    if (outcome.status === 'resolved') {
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
        identity: StalkerPortalIdentity
    ): Promise<
        StalkerPortalEndpointResolution | StalkerPortalDiscoveryRejection
    > {
        try {
            const auth = await withTimeout(
                this.stalkerSession.authenticate(
                    candidate,
                    macAddress,
                    identity
                ),
                AUTH_TIMEOUT_MS
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
            };
        } catch (error) {
            return {
                status: 'auth-rejected',
                portalUrl: candidate,
                error,
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
