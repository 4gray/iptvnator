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
    isStalkerAuthFailureMessage,
    isStalkerAuthFailureResponse,
} from './stalker-portal-discovery.utils';
import {
    getStalkerPortalIdentityFromPlaylist,
    stalkerIdentityFingerprint,
} from './stalker-identity.utils';
import {
    StalkerSessionService,
    type StalkerPortalRepairDiscoveryFence,
} from './stalker-session.service';
import {
    type StalkerPortalRepairApi,
    toStalkerSessionPlaylist,
} from './stores/utils/stalker-request.utils';

/**
 * What a probe of one source configuration concluded this session:
 * an override to (re)install, 'no-change' (probed; the stored configuration
 * is what probing proves, or nothing answered), or 'discarded' (the row
 * moved on mid-probe, so the outcome never applied to any persisted state).
 */
type StalkerProbeRecord = StalkerPortalModeOverride | 'no-change' | 'discarded';

interface StalkerPortalModeOverride {
    /** The failing configuration this repair replaced. */
    sourcePortalUrl?: string;
    sourceIsFullStalkerPortal: boolean;
    /** MAC + Stalker identity the repair probe authenticated as. */
    identityFingerprint: string;
    /** Login/password the repair outcome was negotiated with. */
    credentialsFingerprint: string;
    /** The proven-working configuration. */
    portalUrl: string;
    isFullStalkerPortal: boolean;
}

function stalkerCredentialsFingerprint(playlist: PlaylistMeta): string {
    return JSON.stringify([playlist.username ?? '', playlist.password ?? '']);
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
 * - it probes at most once per SOURCE CONFIGURATION (endpoint, mode, MAC,
 *   identity) per playlist per session — an edited configuration may probe
 *   when it fails, an already-probed one stays latched;
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
     * The OUTCOME of every probe this session, per playlist, keyed by the
     * source-configuration fingerprint: the override the probe produced, or
     * null when it changed nothing. Keeping full history (not just the last
     * entry) stops alternating edits (A→B→A) from re-running discovery via
     * stale snapshots — and keeping the OUTCOME (not just an attempted
     * flag) lets a configuration the user restores reinstall its remembered
     * repair instead of staying broken until restart. A configuration never
     * probed — including one whose mid-probe edit discarded a repair —
     * probes when IT fails.
     */
    private readonly probeHistory = new Map<
        string,
        Map<string, StalkerProbeRecord>
    >();
    private readonly pendingRepairs = new Map<
        string,
        Promise<PlaylistMeta | null>
    >();
    /** Explicit Edit invalidates every repair that started before it. */
    private readonly editGenerations = new Map<string, number>();
    private readonly editFenceCounts = new Map<string, number>();

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
            stalkerIdentityFingerprint(playlist) !==
                override.identityFingerprint ||
            stalkerCredentialsFingerprint(playlist) !==
                override.credentialsFingerprint
        ) {
            // The MAC, Stalker identity, or login was replaced after repair.
            // The override AND its cached token belong to the previous
            // account and must not be applied to a restored row sharing only
            // the playlist ID, endpoint, and device identity.
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
     * Invalidates every repair that started before an explicit Edit, without
     * changing the working override or token yet. Persistence may still fail;
     * in that case the previous runtime connection must remain untouched.
     */
    fenceForPlaylistEdit(playlistId: string): Promise<void> {
        this.editFenceCounts.set(
            playlistId,
            (this.editFenceCounts.get(playlistId) ?? 0) + 1
        );
        this.editGenerations.set(
            playlistId,
            (this.editGenerations.get(playlistId) ?? 0) + 1
        );
        return (
            this.pendingRepairs.get(playlistId)?.catch(() => null) ??
            Promise.resolve()
        ).then(() => undefined);
    }

    /** Releases the repair fence when discovery or persistence fails. */
    releasePlaylistEdit(playlistId: string): void {
        const remaining = (this.editFenceCounts.get(playlistId) ?? 1) - 1;
        if (remaining > 0) {
            this.editFenceCounts.set(playlistId, remaining);
        } else {
            this.editFenceCounts.delete(playlistId);
        }
    }

    /**
     * Removes the pre-edit override after the resolved row and session have
     * been committed. The session coordinator has already replaced or
     * cleared the cached token, so clearing it here would discard the newly
     * authoritative session.
     */
    commitPlaylistEdit(playlistId: string): void {
        this.overrides.delete(playlistId);
        this.releasePlaylistEdit(playlistId);
    }

    /**
     * Retires the session artifacts a repair installed for a playlist: the
     * ACTIVE override and the cached token (authenticated for the pre-edit
     * identity/endpoint). The probe history deliberately survives: it both
     * blocks re-probing of already-attempted configurations (A→B→A cannot
     * loop discovery through stale snapshots) and lets a restored
     * configuration reinstall its remembered repair.
     */
    private dropOverride(playlistId: string): void {
        this.overrides.delete(playlistId);
        this.stalkerSession.clearCachedToken(playlistId);
    }

    /**
     * Whether a failure justifies probing at all. Only the failure shapes a
     * wrong endpoint/mode actually produces qualify: the middleware's
     * plain-text/JSON auth failures (misclassified canonical portal
     * answering a token-less request), HTTP 404 (persisted endpoint does
     * not exist), HTTP 401/403 (endpoint behind an HTTP auth gate), and
     * the session service's terminal auth/handshake errors. Timeouts and
     * other network failures never trigger a probe —
     * a portal that is temporarily down must not be reclassified.
     */
    shouldAttemptRepair(playlist: PlaylistMeta, failure: unknown): boolean {
        if (!playlist._id || !playlist.portalUrl || !playlist.macAddress) {
            return false;
        }

        if (isStalkerAuthFailureResponse(failure)) {
            return true;
        }

        const status = getStalkerRequestErrorStatus(failure);
        if (status === 404 || status === 401 || status === 403) {
            // 404: the persisted endpoint does not exist on this server.
            // 401/403: a token-free-classified playlist hit an HTTP auth
            // gate — discovery classifies these endpoints as auth-required,
            // so the repair must be allowed to reach it.
            return true;
        }

        if (
            failure !== null &&
            typeof failure === 'object' &&
            'message' in failure
        ) {
            const message = String(
                (failure as { message?: unknown }).message ?? ''
            );
            // The SAME failure set the session service uses for error
            // messages — authentication wraps structured denials as
            // `Error('Profile error: Access denied.')` or
            // `Error('Profile error: Invalid token')`, and a narrower
            // pattern here would let those bypass the repair entirely.
            return (
                isStalkerAuthFailureMessage(message) ||
                /handshake failed/i.test(message)
            );
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
        if ((this.editFenceCounts.get(playlistId) ?? 0) > 0) {
            return null;
        }

        const pending = this.pendingRepairs.get(playlistId);
        if (pending) {
            // Wait the in-flight probe out, then RE-ENTER: the caller may
            // carry a different (edited) configuration whose fingerprint
            // was never attempted — it must get its own probe instead of
            // inheriting whatever the old repair concluded.
            await pending;
            return this.repairPortal(playlist);
        }

        const fingerprint = this.repairSourceFingerprint(playlist);
        const history = this.probeHistory.get(playlistId) ?? new Map();
        const record = history.get(fingerprint) as
            StalkerProbeRecord | undefined;
        if (record === 'discarded') {
            // The probe for this configuration was discarded because the
            // row had moved on mid-probe. If the row has since been
            // RESTORED to it, the outcome was never recorded — probe again.
            // A stale snapshot (row still elsewhere) stays declined, gated
            // by one cheap row read instead of a discovery run.
            if (!(await this.rowCurrentlyMatches(playlist))) {
                return this.reapplyIfChanged(playlist);
            }
            history.delete(fingerprint);
        } else if (record !== undefined) {
            if (
                record !== 'no-change' &&
                !this.overrides.has(playlistId) &&
                // Reinstall ONLY when the persisted row actually carries
                // this configuration again. A stale request for A while the
                // row now holds an unrelated C must not resurrect A's
                // override — that would retry against B and repoint the
                // watchdog away from C.
                (await this.rowCurrentlyMatches(playlist))
            ) {
                // The user restored a configuration whose override was
                // dropped by an intermediate edit: reinstall the remembered
                // outcome — probing again is unnecessary, and doing nothing
                // would leave the restored configuration broken until
                // restart.
                this.overrides.set(playlistId, record);
                // Same synchronization as a fresh repair: if the
                // intermediate configuration stopped the active watchdog,
                // the restored full-portal session needs its keepalive back.
                this.stalkerSession.refreshActiveWatchdogPlaylist(
                    toStalkerSessionPlaylist(this.applyOverride(playlist))
                );
            }
            return this.reapplyIfChanged(playlist);
        }

        // Reserved BEFORE the probe; the run overwrites it with the
        // produced override or the 'discarded' marker.
        history.set(fingerprint, 'no-change');
        this.probeHistory.set(playlistId, history);
        const authenticationFence: StalkerPortalRepairDiscoveryFence =
            this.stalkerSession.beginPortalRepairDiscovery(playlistId);
        const run = authenticationFence.drained.then(() =>
            this.runRepair(playlist, this.editGenerations.get(playlistId) ?? 0)
        );
        this.pendingRepairs.set(playlistId, run);
        try {
            return await run;
        } finally {
            this.pendingRepairs.delete(playlistId);
            this.stalkerSession.completePortalRepairDiscovery(
                authenticationFence
            );
        }
    }

    /** Lets request routing choose its effective row after repair settles. */
    async waitForPendingRepair(playlistId: string): Promise<void> {
        await this.pendingRepairs.get(playlistId)?.catch(() => null);
    }

    /**
     * Everything a probe's outcome depends on: endpoint, mode, MAC and the
     * full Stalker identity — the same field set `rowStillMatchesSource`
     * verifies before committing.
     */
    private repairSourceFingerprint(playlist: PlaylistMeta): string {
        // JSON-encoded for the same reason as the identity fingerprint:
        // unrestricted values must not alias across field boundaries.
        return JSON.stringify([
            playlist.portalUrl ?? '',
            isFullStalkerPortalPlaylist(playlist),
            stalkerIdentityFingerprint(playlist),
            // Credentials are part of the discovery outcome now: a probe that
            // failed on a wrong login must be retried once the login is
            // corrected, instead of staying declined until the app restarts.
            playlist.username ?? '',
            playlist.password ?? '',
        ]);
    }

    private reapplyIfChanged(playlist: PlaylistMeta): PlaylistMeta | null {
        const applied = this.applyOverride(playlist);
        return applied === playlist ? null : applied;
    }

    private async runRepair(
        playlist: PlaylistMeta,
        editGeneration: number
    ): Promise<PlaylistMeta | null> {
        // A request sent before an explicit Edit can fail only after that Edit
        // commits and releases its fence. Verify the caller still owns the
        // persisted source before discovery: confirmation may authenticate
        // against the old portal and invalidate the freshly edited session
        // even though the atomic transform below would reject its write.
        if (
            !(await this.rowCurrentlyMatches(playlist)) ||
            this.editGenerationChanged(playlist._id, editGeneration)
        ) {
            return this.discardSupersededRepair(playlist);
        }

        const outcome = await this.discovery.discover(
            playlist.portalUrl ?? '',
            playlist.macAddress ?? '',
            getStalkerPortalIdentityFromPlaylist(playlist),
            {
                // A login/password portal answers `get_profile` with status 2
                // during confirmation. Without the stored credentials the
                // probe reports `login-required` and such a source could
                // never be repaired, even though the playlist holds a
                // working login.
                credentials: {
                    username: playlist.username,
                    password: playlist.password,
                },
            }
        );

        if (outcome.status !== 'resolved') {
            this.logger.info(
                `Portal probe found no working configuration (${outcome.status}); leaving playlist untouched`
            );
            if (
                outcome.status === 'auth-rejected' &&
                outcome.abandonedInFlight
            ) {
                // Returning the repair would release its session fence. The
                // transport can outlive discovery's bounded error, so hold
                // every runtime authenticator until the old get_profile has
                // actually settled. Missing lifetime evidence fails closed.
                await (outcome.abandonedAuthenticationSettled ??
                    new Promise<void>(() => undefined));
            }
            return null;
        }

        if (this.editGenerationChanged(playlist._id, editGeneration)) {
            return this.discardSupersededRepair(playlist);
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
                        if (
                            this.editGenerationChanged(
                                playlist._id,
                                editGeneration
                            ) ||
                            !this.rowMatchesSource(row, playlist, storedMode)
                        ) {
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
            this.logger.warn('Persisting repaired portal mode failed', error);
        }

        if (
            !verifiedAgainstRow ||
            this.editGenerationChanged(playlist._id, editGeneration)
        ) {
            return this.discardSupersededRepair(playlist);
        }

        const override: StalkerPortalModeOverride = {
            sourcePortalUrl: playlist.portalUrl,
            sourceIsFullStalkerPortal: storedMode,
            identityFingerprint: stalkerIdentityFingerprint(playlist),
            credentialsFingerprint: stalkerCredentialsFingerprint(playlist),
            portalUrl: outcome.portalUrl,
            isFullStalkerPortal: outcome.isFullStalkerPortal,
        };
        this.overrides.set(playlist._id, override);
        this.probeHistory
            .get(playlist._id)
            ?.set(this.repairSourceFingerprint(playlist), override);

        if (outcome.isFullStalkerPortal && outcome.token) {
            // The classification handshake already authenticated; adopt the
            // whole session so the retry does not handshake again AND the
            // cadence that profile advertised is applied — caching the token
            // alone would satisfy the retry and leave the repaired playlist
            // pinging on the default until restart. The identity source is
            // the REPAIRED configuration: a repair never changes WHO the
            // session belongs to, only WHERE it talks, and the session is
            // bound to that endpoint.
            this.stalkerSession.adoptDiscoveredSession(
                playlist._id,
                toStalkerSessionPlaylist(this.applyOverride(playlist)),
                {
                    token: outcome.token,
                    watchdogTimeoutSeconds: outcome.watchdogTimeoutSeconds,
                    timeslotSeconds: outcome.timeslotSeconds,
                }
            );
        } else if (!outcome.isFullStalkerPortal) {
            this.stalkerSession.adoptDiscoveredSimplePortal(
                toStalkerSessionPlaylist(this.applyOverride(playlist))
            );
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

    private editGenerationChanged(
        playlistId: string,
        expected: number
    ): boolean {
        return (this.editGenerations.get(playlistId) ?? 0) !== expected;
    }

    private discardSupersededRepair(
        playlist: PlaylistMeta
    ): PlaylistMeta | null {
        this.logger.info(
            'Portal configuration changed while probing; discarding repair'
        );
        // A later failure may probe again if this source is restored.
        this.probeHistory
            .get(playlist._id)
            ?.set(this.repairSourceFingerprint(playlist), 'discarded');
        return null;
    }

    /**
     * Cheap preflight for an unrecorded or DISCARDED configuration: reads the
     * current row and reports whether it still carries the caller's source.
     * This prevents stale discovery from authenticating against an edited
     * portal; the authoritative write guard remains the atomic transform.
     */
    private async rowCurrentlyMatches(
        playlist: PlaylistMeta
    ): Promise<boolean> {
        try {
            const row = await firstValueFrom(
                this.injector
                    .get(PlaylistsService)
                    .getPlaylistById(playlist._id)
            );
            return (
                !!row &&
                this.repairSourceFingerprint(row) ===
                    this.repairSourceFingerprint(playlist)
            );
        } catch {
            return false;
        }
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
                stalkerIdentityFingerprint(playlist) &&
            // Credentials too, matching repairSourceFingerprint(): discovery
            // can run for tens of seconds, and a login saved meanwhile means
            // the outcome was negotiated for an account the row no longer
            // belongs to — committing it would adopt the wrong session.
            (row.username ?? '') === (playlist.username ?? '') &&
            (row.password ?? '') === (playlist.password ?? '')
        );
    }
}
