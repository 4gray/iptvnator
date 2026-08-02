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
import { getStalkerPortalIdentityFromPlaylist } from './stalker-identity.utils';
import { StalkerSessionService } from './stalker-session.service';
import {
    type StalkerPortalRepairApi,
    toStalkerSessionPlaylist,
} from './stores/utils/stalker-request.utils';

interface StalkerPortalModeOverride {
    /** The failing configuration this repair replaced. */
    sourcePortalUrl?: string;
    sourceIsFullStalkerPortal: boolean;
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
     * Source-configuration fingerprint already probed this session, per
     * playlist. Keyed by CONFIG, not just id: a stale snapshot of an
     * already-probed configuration must not re-probe (loop guard), while a
     * configuration the user edited afterwards — including one whose
     * mid-probe edit discarded a repair — must be allowed to probe when IT
     * fails.
     */
    private readonly attemptedSources = new Map<string, string>();
    private readonly pendingRepairs = new Map<
        string,
        Promise<PlaylistMeta | null>
    >();

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

        this.overrides.delete(playlist._id);
        this.attemptedSources.delete(playlist._id);
        return playlist;
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

        if (
            this.attemptedSources.get(playlistId) ===
            this.repairSourceFingerprint(playlist)
        ) {
            return this.reapplyIfChanged(playlist);
        }

        this.attemptedSources.set(
            playlistId,
            this.repairSourceFingerprint(playlist)
        );
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
        const normalize = (value: unknown): string =>
            typeof value === 'string' ? value.trim() : '';
        return [
            playlist.portalUrl ?? '',
            String(isFullStalkerPortalPlaylist(playlist)),
            normalize(playlist.macAddress),
            normalize(playlist.stalkerSerialNumber),
            normalize(playlist.stalkerDeviceId1),
            normalize(playlist.stalkerDeviceId2),
            normalize(playlist.stalkerSignature1),
            normalize(playlist.stalkerSignature2),
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
        // meanwhile. Commit the repair ONLY if the persisted row still
        // carries the configuration that failed — otherwise the edited row
        // must win and the repair result for the old URL is discarded.
        if (!(await this.rowStillMatchesSource(playlist, storedMode))) {
            this.logger.info(
                'Portal configuration changed while probing; discarding repair'
            );
            return null;
        }

        this.overrides.set(playlist._id, {
            sourcePortalUrl: playlist.portalUrl,
            sourceIsFullStalkerPortal: storedMode,
            portalUrl: outcome.portalUrl,
            isFullStalkerPortal: outcome.isFullStalkerPortal,
        });

        if (outcome.isFullStalkerPortal && outcome.token) {
            // The classification handshake already authenticated; reuse its
            // token so the retry does not immediately handshake again.
            this.stalkerSession.setCachedToken(playlist._id, outcome.token);
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

        await this.persistRepair(playlist._id, outcome.portalUrl, outcome.isFullStalkerPortal);

        return this.applyOverride(playlist);
    }

    /**
     * Re-reads the persisted row and reports whether it still carries the
     * configuration the repair was computed for. A missing row (playlist
     * deleted mid-probe) or an unreadable store counts as NOT matching —
     * never write when the premise cannot be verified.
     */
    private async rowStillMatchesSource(
        playlist: PlaylistMeta,
        sourceMode: boolean
    ): Promise<boolean> {
        try {
            const row = await firstValueFrom(
                this.injector
                    .get(PlaylistsService)
                    .getPlaylistById(playlist._id)
            );
            if (
                !row ||
                row.portalUrl !== playlist.portalUrl ||
                isFullStalkerPortalPlaylist(row) !== sourceMode
            ) {
                return false;
            }

            // The probe also authenticated AS an identity: a MAC or device
            // identity edited during the multi-second probe must discard the
            // repair too, or its token/watchdog would belong to the old
            // account. Blank and absent identity values are equivalent.
            const normalize = (value: unknown): string =>
                typeof value === 'string' ? value.trim() : '';
            return (
                normalize(row.macAddress) === normalize(playlist.macAddress) &&
                normalize(row.stalkerSerialNumber) ===
                    normalize(playlist.stalkerSerialNumber) &&
                normalize(row.stalkerDeviceId1) ===
                    normalize(playlist.stalkerDeviceId1) &&
                normalize(row.stalkerDeviceId2) ===
                    normalize(playlist.stalkerDeviceId2) &&
                normalize(row.stalkerSignature1) ===
                    normalize(playlist.stalkerSignature1) &&
                normalize(row.stalkerSignature2) ===
                    normalize(playlist.stalkerSignature2)
            );
        } catch (error) {
            this.logger.warn(
                'Could not verify the stored portal row; discarding repair',
                error
            );
            return false;
        }
    }

    private async persistRepair(
        playlistId: string,
        portalUrl: string,
        isFullStalkerPortal: boolean
    ): Promise<void> {
        try {
            // Minimal patch on purpose: updatePlaylistMeta merges only the
            // defined fields into a freshly read row, so a stale in-memory
            // meta object can never clobber favorites or other user state.
            await firstValueFrom(
                this.injector.get(PlaylistsService).updatePlaylistMeta({
                    _id: playlistId,
                    portalUrl,
                    isFullStalkerPortal,
                } as PlaylistMeta)
            );
        } catch (error) {
            // The in-session override still applies; persistence gets
            // another chance the next time the stored row fails.
            this.logger.warn(
                'Persisting repaired portal mode failed; keeping session-only override',
                error
            );
        }
    }
}
