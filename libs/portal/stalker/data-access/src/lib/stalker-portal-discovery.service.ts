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
                if (status !== undefined && status >= 400 && status < 500) {
                    // Endpoint absent but the host answered — keep probing.
                    continue;
                }
                // Network-level failure: every candidate lives on the same
                // host, so further probing cannot succeed either.
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
                    try {
                        const auth = await withTimeout(
                            this.stalkerSession.authenticate(
                                candidate,
                                macAddress,
                                identity
                            ),
                            AUTH_TIMEOUT_MS
                        );
                        return {
                            status: 'resolved',
                            portalUrl: candidate,
                            isFullStalkerPortal: true,
                            token: auth.token,
                            accountInfo: auth.accountInfo,
                        };
                    } catch (error) {
                        // The endpoint is real but refused our credentials;
                        // remember the first such endpoint in case no later
                        // candidate resolves.
                        authRejection = authRejection ?? {
                            status: 'auth-rejected',
                            portalUrl: candidate,
                            error,
                        };
                        continue;
                    }
                }
                case 'not-a-portal':
                    continue;
            }
        }

        return authRejection ?? { status: 'unreachable' };
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
