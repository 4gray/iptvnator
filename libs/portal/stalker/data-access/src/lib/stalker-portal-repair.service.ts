import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PlaylistsService } from '@iptvnator/services';
import {
    isFullStalkerPortalPlaylist,
    type PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { createLogger } from '@iptvnator/portal/shared/util';
import { StalkerPortalDiscoveryService } from './stalker-portal-discovery.service';
import {
    getStalkerRequestErrorStatus,
    isStalkerAuthFailureResponse,
} from './stalker-portal-discovery.utils';
import {
    getStalkerPortalIdentityFromPlaylist,
    stalkerIdentityFingerprint,
} from './stalker-identity.utils';
import { StalkerSessionService } from './stalker-session.service';
import {
    type StalkerPortalRepairApi,
    toStalkerSessionPlaylist,
} from './stores/utils/stalker-request.utils';

interface StalkerPortalModeOverride {
    /** The failing configuration this repair replaced. */
    sourcePortalUrl?: string;
    sourceIsFullStalkerPortal: boolean;
    /** MAC + Stalker identity the repair probe authenticated as. */
    identityFingerprint: string;
    /** The proven-working configuration. */
    portalUrl: string;
    isFullStalkerPortal: boolean;
}



/**
 * Lazy repair for playlists whose persisted portal endpoint or mode is
 * wrong. The flag used to be a URL-shape guess frozen at import, so a
 * canonical `…/server/load.php` portal could sit misclassified as
 * token-free forever — every request answered `Authorization failed.` and
 * the only "fix" was deleting the playlist (losing favorites, recents and
 * positions).
 *
 * Deliberately NOT an eager one-shot migration: a large share of users are
 * on reseller `portal.php` panels that work without any auth, and nothing
 * short of probing can distinguish those from misclassified canonical
 * portals. Instead, repair is evidence-driven and conservative:
 *
 * - it runs only after a request ACTUALLY failed with a repair trigger
 *   (the middleware's plain-text auth bodies, or HTTP 404 — a portal that
 *   works is never probed, let alone rewritten);
 * - it probes at most once per playlist per session;
 * - it persists only a configuration that discovery PROVED to answer, and
 *   only when that configuration differs from the failing one.
 *
 * A successful repair also installs an in-session override so already-held
 * stale playlist objects (store state, route snapshots) start using the
 * corrected endpoint immediately — the persisted row makes it permanent.
 */
@Injectable({ providedIn: 'root' })
export class StalkerPortalRepairService implements StalkerPortalRepairApi {
    private readonly discovery = inject(StalkerPortalDiscoveryService);
    // Resolved lazily: PlaylistsService pulls the whole persistence stack
    // (IndexedDB, snackbar, translations) and is only needed at the moment a
    // repair actually persists — never on the hot request path.
    private readonly injector = inject(Injector);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly logger = createLogger('StalkerPortalRepair');

    private readonly overrides = new Map<string, StalkerPortalModeOverride>();
    /**
     * EVERY source-configuration fingerprint already probed this session,
     * per playlist. Keyed by CONFIG, not just id: a stale snapshot of an
     * already-probed configuration must not re-probe (loop guard) — and the
     * full history matters, because alternating edits (A→B→A) would
     * otherwise evict A's fingerprint and let its stale snapshots run the
     * expensive discovery again. A configuration never probed — including
     * one whose mid-probe edit discarded a repair — probes when IT fails.
     */
    private readonly attemptedSources = new Map<string, Set<string>>();
    private readonly pendingRepairs = new Map<
        string,
        Promise<PlaylistMeta | null>
    >();

    constructor() {
        // The watchdog resolves its playlist from the persisted row; while a
        // repair's persistence is pending (or failed) that row still carries
        // the broken configuration, so pings must see the override too. The
        // typeof guard keeps isolated TestBeds with partial session mocks
        // working.
        if (
            typeof this.stalkerSession.registerWatchdogPlaylistDecorator ===
            'function'
        ) {
            this.stalkerSession.registerWatchdogPlaylistDecorator((playlist) =>
                this.applyOverride(playlist)
            );
        }
    }

    /**
     * Returns the playlist with a completed repair applied, or the playlist
     * unchanged (same reference) when there is nothing to apply.
     *
     * The override is tied to the SOURCE configuration it repaired: it only
     * rewrites objects still carrying that failing configuration (stale
     * store snapshots). A playlist carrying anything else means the user
     * edited the portal metadata through the playlist dialog — the override
     * and the once-per-session probe latch are dropped so the edited
     * configuration is used verbatim and may repair again if IT fails.
     */
    applyOverride<T extends PlaylistMeta>(playlist: T): T {
        const override = this.overrides.get(playlist._id);
        if (!override) {
            return playlist;
        }

        if (
            stalkerIdentityFingerprint(playlist) !== override.identityFingerprint
        ) {
            // The MAC or Stalker identity was edited after the repair. The
            // override AND the token the repair authenticated for the
            // PREVIOUS identity must go — otherwise requests and watchdog
            // pings would pair the edited identity with a foreign session.
            this.dropOverride(playlist._id);
            return playlist;
        }

        if (
            playlist.portalUrl === override.portalUrl &&
            playlist.isFullStalkerPortal === override.isFullStalkerPortal
        ) {
            // Already carrying the repaired values (e.g. a freshly read row).
            return playlist;
        }

        if (
            playlist.portalUrl === override.sourcePortalUrl &&
            isFullStalkerPortalPlaylist(playlist) ===
                override.sourceIsFullStalkerPortal
        ) {
            return {
                ...playlist,
                portalUrl: override.portalUrl,
                isFullStalkerPortal: override.isFullStalkerPortal,
            };
        }

        // The portal URL or mode was edited to something else entirely —
        // same story: the edited configuration is used verbatim and the
        // repair session state is retired.
        this.dropOverride(playlist._id);
        return playlist;
    }

    /**
     * Retires the session artifacts a repair installed for a playlist: the
     * override and the cached token (authenticated for the pre-edit
     * identity/endpoint). The probe HISTORY deliberately survives — the
     * per-config latch already lets a never-probed configuration through,
     * and forgetting probed ones would let alternating edits (A→B→A) loop
     * discovery through stale snapshots.
     */
    private dropOverride(playlistId: string): void {
        this.overrides.delete(playlistId);
        this.stalkerSession.clearCachedToken(playlistId);
    }

    /**
     * Whether a failure justifies probing at all. Only the failure shapes a
     * wrong endpoint/mode actually produces qualify: the middleware's
     * plain-text auth bodies (misclassified canonical portal answering a
     * token-less request), HTTP 404 (persisted endpoint does not exist on
     * this server), and the session service's terminal auth/handshake
     * errors. Timeouts and other network failures never trigger a probe —
     * a portal that is temporarily down must not be reclassified.
     */
    shouldAttemptRepair(playlist: PlaylistMeta, failure: unknown): boolean {
        if (!playlist._id || !playlist.portalUrl || !playlist.macAddress) {
            return false;
        }

        if (isStalkerAuthFailureResponse(failure)) {
            return true;
        }

        if (getStalkerRequestErrorStatus(failure) === 404) {
            return true;
        }

        if (failure !== null && typeof failure === 'object' && 'message' in failure) {
            const message = String(
                (failure as { message?: unknown }).message ?? ''
            );
            return /authorization failed|handshake failed/i.test(message);
        }

        return false;
    }

    /**
     * Probes the stored portal and, when discovery proves a DIFFERENT
     * working configuration, persists it and returns the patched playlist
     * for a one-shot retry. Returns null when nothing may change: probe
     * found nothing, probe confirmed the stored configuration (the failure
     * has another cause, e.g. an expired subscription), or a repair for
     * this playlist already ran this session.
     */
    async repairPortal(playlist: PlaylistMeta): Promise<PlaylistMeta | null> {
        const playlistId = playlist._id;

        const pending = this.pendingRepairs.get(playlistId);
        if (pending) {
            await pending;
            return this.reapplyIfChanged(playlist);
        }

        const fingerprint = this.repairSourceFingerprint(playlist);
        const attempted = this.attemptedSources.get(playlistId) ?? new Set();
        if (attempted.has(fingerprint)) {
            return this.reapplyIfChanged(playlist);
        }

        attempted.add(fingerprint);
        this.attemptedSources.set(playlistId, attempted);
        const run = this.runRepair(playlist);
        this.pendingRepairs.set(playlistId, run);
        try {
            return await run;
        } finally {
            this.pendingRepairs.delete(playlistId);
        }
    }

    /**
     * Everything a probe's outcome depends on: endpoint, mode, MAC and the
     * full Stalker identity — the same field set `rowStillMatchesSource`
     * verifies before committing.
     */
    private repairSourceFingerprint(playlist: PlaylistMeta): string {
        return [
            playlist.portalUrl ?? '',
            String(isFullStalkerPortalPlaylist(playlist)),
            stalkerIdentityFingerprint(playlist),
        ].join('|');
    }

    private reapplyIfChanged(playlist: PlaylistMeta): PlaylistMeta | null {
        const applied = this.applyOverride(playlist);
        return applied === playlist ? null : applied;
    }

    private async runRepair(
        playlist: PlaylistMeta
    ): Promise<PlaylistMeta | null> {
        const outcome = await this.discovery.discover(
            playlist.portalUrl ?? '',
            playlist.macAddress ?? '',
            getStalkerPortalIdentityFromPlaylist(playlist)
        );

        if (outcome.status !== 'resolved') {
            this.logger.info(
                `Portal probe found no working configuration (${outcome.status}); leaving playlist untouched`
            );
            return null;
        }

        const storedMode = isFullStalkerPortalPlaylist(playlist);
        if (
            outcome.portalUrl === playlist.portalUrl &&
            outcome.isFullStalkerPortal === storedMode
        ) {
            // The stored configuration is exactly what probing proves — the
            // failure has a different cause and rewriting would fix nothing.
            return null;
        }

        // TOCTOU guard: the probe can run for tens of seconds, and the user
        // may have edited the portal metadata (or deleted the playlist)
        // meanwhile. The verification and the patch run ATOMICALLY inside
        // the per-playlist write queue — a plain read-check-then-update
        // pair would still race an edit that is queued but not committed.
        // The transform patches the FRESH row, so nothing stale can clobber
        // user state; returning null aborts without writing.
        let verifiedAgainstRow = false;
        try {
            await firstValueFrom(
                this.injector
                    .get(PlaylistsService)
                    .transformPlaylistMeta(playlist._id, (row) => {
                        if (!this.rowMatchesSource(row, playlist, storedMode)) {
                            return null;
                        }
                        verifiedAgainstRow = true;
                        return {
                            ...row,
                            portalUrl: outcome.portalUrl,
                            isFullStalkerPortal: outcome.isFullStalkerPortal,
                        };
                    })
            );
        } catch (error) {
            // A failed WRITE after successful verification keeps the
            // session-only override below; a failed READ means the premise
            // could not be verified and the repair is discarded.
            this.logger.warn(
                'Persisting repaired portal mode failed',
                error
            );
        }

        if (!verifiedAgainstRow) {
            this.logger.info(
                'Portal configuration changed while probing; discarding repair'
            );
            return null;
        }

        this.overrides.set(playlist._id, {
            sourcePortalUrl: playlist.portalUrl,
            sourceIsFullStalkerPortal: storedMode,
            identityFingerprint: stalkerIdentityFingerprint(playlist),
            portalUrl: outcome.portalUrl,
            isFullStalkerPortal: outcome.isFullStalkerPortal,
        });

        if (outcome.isFullStalkerPortal && outcome.token) {
            // The classification handshake already authenticated; reuse its
            // token so the retry does not immediately handshake again. The
            // playlist itself is the identity source — a repair never
            // changes WHO the session belongs to, only WHERE it talks.
            this.stalkerSession.setCachedToken(
                playlist._id,
                outcome.token,
                playlist
            );
        } else if (!outcome.isFullStalkerPortal) {
            this.stalkerSession.clearCachedToken(playlist._id);
        }

        // If this playlist currently owns the watchdog, re-sync it with the
        // repaired configuration: a simple→full repair must START the
        // keepalive and an endpoint change must repoint it — the session
        // service otherwise keeps the activation-time snapshot forever.
        this.stalkerSession.refreshActiveWatchdogPlaylist(
            toStalkerSessionPlaylist(this.applyOverride(playlist))
        );

        this.logger.info(
            `Repaired portal mode: isFullStalkerPortal=${outcome.isFullStalkerPortal}`
        );

        return this.applyOverride(playlist);
    }

    /**
     * Whether the persisted row still carries the configuration the repair
     * was computed for — endpoint, mode, and the identity the probe
     * authenticated as. Runs synchronously INSIDE the atomic transform.
     */
    private rowMatchesSource(
        row: PlaylistMeta,
        playlist: PlaylistMeta,
        sourceMode: boolean
    ): boolean {
        return (
            row.portalUrl === playlist.portalUrl &&
            isFullStalkerPortalPlaylist(row) === sourceMode &&
            stalkerIdentityFingerprint(row) ===
                stalkerIdentityFingerprint(playlist)
        );
    }

}
