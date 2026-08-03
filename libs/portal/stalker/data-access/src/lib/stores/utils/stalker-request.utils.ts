import { DataService } from '@iptvnator/services';
import {
    isFullStalkerPortalPlaylist,
    Playlist,
    PlaylistMeta,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '../../stalker-session.service';

/**
 * The slice of `StalkerPortalRepairService` the request pipeline needs.
 * Declared here (instead of importing the service) so the service can live
 * at the lib root and depend on these utils without a cycle.
 */
export interface StalkerPortalRepairApi {
    /** Applies a completed repair; returns the SAME reference when no-op. */
    applyOverride<T extends PlaylistMeta>(playlist: T): T;
    /** Whether this failure shape justifies probing the portal at all. */
    shouldAttemptRepair(playlist: PlaylistMeta, failure: unknown): boolean;
    /**
     * Probes and persists a proven-different configuration; null when
     * nothing may change.
     */
    repairPortal(playlist: PlaylistMeta): Promise<PlaylistMeta | null>;
}

export interface StalkerRequestDeps {
    dataService: DataService;
    stalkerSession: StalkerSessionService;
    /** Optional lazy portal-mode repair; wired by the store feature slices. */
    portalRepair?: StalkerPortalRepairApi;
}

export function toStalkerSessionPlaylist(playlist: PlaylistMeta): Playlist {
    return {
        lastUsage: '',
        ...playlist,
    } as Playlist;
}

/**
 * Establishes the portal session WITHOUT issuing a content request.
 *
 * Needed wherever playback returns a URL without calling the portal: minting
 * a link used to be what authenticated, and tokens live in memory only
 * (`StalkerSessionService.tokenCache`), so a cold start would otherwise hand
 * a same-host gated stream headers with no `Authorization`. `ensureToken`
 * also validates the identity the cached token was negotiated for, which the
 * raw `getCachedToken()` the header builders use cannot.
 *
 * Cheap where it is not needed: a simple portal returns immediately, and a
 * warm cache with a matching fingerprint resolves without a request.
 *
 * Best-effort on purpose — a static URL may point at a CDN that needs no
 * credentials, so a failed handshake must not cost the user their playback.
 */
export async function ensureStalkerSession(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta | undefined,
    logger?: { warn(...args: unknown[]): void }
): Promise<void> {
    if (!playlist || !isFullStalkerPortalPlaylist(playlist)) {
        return;
    }

    try {
        await deps.stalkerSession.ensureToken(
            toStalkerSessionPlaylist(playlist)
        );
    } catch (error) {
        logger?.warn('Could not establish the Stalker session', error);
    }
}

/**
 * Routes one Stalker request according to the playlist's portal mode:
 * full portals go through the authenticated session (handshake + Bearer
 * token + retry), token-free panels are called directly. The mode comes
 * from the shared `isFullStalkerPortalPlaylist` predicate — the single
 * rule every portal-mode consumer uses.
 */
async function dispatchStalkerRequest<T>(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    params: Record<string, string | number>
): Promise<T> {
    if (isFullStalkerPortalPlaylist(playlist)) {
        return deps.stalkerSession.makeAuthenticatedRequest<T>(
            toStalkerSessionPlaylist(playlist),
            params
        );
    }

    return deps.dataService.sendIpcEvent<T>(STALKER_REQUEST, {
        url: playlist.portalUrl,
        macAddress: playlist.macAddress,
        params,
    });
}

/**
 * Single choke point for Stalker API calls. On top of the mode routing it
 * hooks the lazy portal repair: when a request fails in a way only a wrong
 * persisted endpoint/mode produces (plain-text `Authorization failed.`
 * bodies on token-less requests, HTTP 404 on a vanished endpoint, terminal
 * handshake failures), the repair service re-probes the portal once per
 * session and — only when a different configuration is PROVEN to work —
 * the request is retried against it. Healthy portals never probe.
 */
export async function executeStalkerRequest<T>(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    params: Record<string, string | number>
): Promise<T> {
    const effective = deps.portalRepair
        ? deps.portalRepair.applyOverride(playlist)
        : playlist;

    try {
        const response = await dispatchStalkerRequest<T>(
            deps,
            effective,
            params
        );

        if (deps.portalRepair?.shouldAttemptRepair(effective, response)) {
            const repaired = await deps.portalRepair.repairPortal(effective);
            if (repaired) {
                return dispatchStalkerRequest<T>(deps, repaired, params);
            }
        }

        return response;
    } catch (error) {
        if (deps.portalRepair?.shouldAttemptRepair(effective, error)) {
            const repaired = await deps.portalRepair.repairPortal(effective);
            if (repaired) {
                return dispatchStalkerRequest<T>(deps, repaired, params);
            }
        }

        throw error;
    }
}
