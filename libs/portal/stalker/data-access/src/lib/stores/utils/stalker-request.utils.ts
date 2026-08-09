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
    /** Waits until repair can no longer change the effective connection. */
    waitForPendingRepair?(playlistId: string): Promise<void>;
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
 *
 * Returns whether the session is good enough to serve a stream that needs
 * portal credentials: `true` for a portal that needs no token at all and for
 * one that has a usable token, `false` for a full portal left without one.
 * Callers use it to decide whether a portal-owned static URL can be trusted or
 * whether they should fall back to the request path — which is also the path
 * that can observe a failure and trigger the lazy repair.
 */
export async function ensureStalkerSession(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta | undefined,
    logger?: { warn(...args: unknown[]): void }
): Promise<boolean> {
    if (!playlist) {
        return false;
    }

    await deps.portalRepair?.waitForPendingRepair?.(playlist._id);

    // The repair override is applied here for the same reason
    // `executeStalkerRequest` applies it on its first line: a completed repair
    // may have moved the endpoint or the mode while the caller still holds the
    // pre-repair row, and handshaking against the configuration a repair has
    // already proven broken would strand the session.
    const effective = deps.portalRepair
        ? deps.portalRepair.applyOverride(playlist)
        : playlist;

    try {
        const { token } = await deps.stalkerSession.ensureToken(
            toStalkerSessionPlaylist(effective)
        );
        // `ensureToken` is also the post-Edit configuration guard. For a
        // simple portal it returns immediately with no token and no network
        // request, but still rejects a snapshot whose observed mode is stale.
        return isFullStalkerPortalPlaylist(effective) ? Boolean(token) : true;
    } catch (error) {
        logger?.warn('Could not establish the Stalker session', error);
        return false;
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

    // A direct request has no authentication layer to invoke the Edit
    // authority guard. `ensureToken` is network-free in simple mode, and
    // prevents a pre-Edit simple snapshot from issuing a token-free request
    // after the same endpoint has been reclassified as full.
    const sessionPlaylist = toStalkerSessionPlaylist(playlist);
    await deps.stalkerSession.ensureToken(sessionPlaylist);

    const response = await deps.dataService.sendIpcEvent<T>(STALKER_REQUEST, {
        url: playlist.portalUrl,
        macAddress: playlist.macAddress,
        params,
    });
    // Re-check after transport: Edit may have committed while the direct
    // request was in flight. In simple mode this guard remains network-free.
    await deps.stalkerSession.ensureToken(sessionPlaylist);
    return response;
}

/**
 * Choke point for Stalker catalog, content and playback calls. On top of the
 * mode routing it hooks the lazy portal repair: when a request fails in a way
 * only a wrong persisted endpoint/mode produces (plain-text
 * `Authorization failed.` bodies on token-less requests, HTTP 404 on a
 * vanished endpoint, terminal handshake failures), the repair service
 * re-probes the portal once per session and — only when a different
 * configuration is PROVEN to work — the request is retried against it.
 * Healthy portals never probe.
 *
 * Four callers deliberately issue `STALKER_REQUEST` themselves, because each
 * runs BELOW or BEFORE what this routes on:
 *
 * - `StalkerAuthApi` — `handshake`/`get_profile`/`do_auth` are what the
 *   full-portal branch here is implemented in terms of, so routing them back
 *   through it would recurse.
 * - `StalkerPortalDiscoveryService` — probes precede the mode they determine.
 * - `StalkerAccountInfoService.fetchViaProfile()` — a profile request, so it
 *   takes the same exemption as the auth layer.
 * - `StreamResolverService`, for a collection item carrying its own portal
 *   coordinates with no playlist row — there is no meta to route or repair
 *   with. Its row-backed branch does come through here.
 *
 * The exemption is from the ROUTING, not from the repair hooked above — but
 * only `fetchViaProfile()` wires `StalkerPortalRepairService` itself.
 * Discovery is what repair drives, the row-less branch has no playlist to
 * repair, and the auth layer needs nothing: a terminal handshake failure
 * propagates out of the full-portal branch below and is caught here, which is
 * why it is one of the triggers listed above.
 *
 * Anything new that is not auth or discovery belongs here.
 */
export async function executeStalkerRequest<T>(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    params: Record<string, string | number>
): Promise<T> {
    await deps.portalRepair?.waitForPendingRepair?.(playlist._id);
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
