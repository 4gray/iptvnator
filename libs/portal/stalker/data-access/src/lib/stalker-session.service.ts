import { Injectable, Injector, inject } from '@angular/core';
import {
    isFullStalkerPortalPlaylist,
    isFullStalkerPortalUrl,
    Playlist,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    getStalkerPortalIdentityFromPlaylist,
    LEGACY_DEFAULT_STALKER_SERIAL,
    normalizeStalkerPortalIdentity,
    stalkerIdentityFingerprint,
    type StalkerPortalIdentity,
} from './stalker-identity.utils';
import {
    StalkerAuthApi,
    type StalkerAuthenticateOptions,
    type StalkerAuthenticationResult,
    type StalkerHandshakeResponse,
    type StalkerPortalCredentials,
    type StalkerProfileResponse,
} from './stalker-auth.api';
import { StalkerAuthenticatedRequestClient } from './stalker-authenticated-request-client';
import { StalkerEditedSessionCoordinator } from './stalker-edited-session-coordinator';
import type { StalkerEditFence } from './stalker-edited-session-coordinator';
import {
    StalkerPortalRepairDiscoveryCoordinator,
    type StalkerPortalRepairDiscoveryFence,
} from './stalker-portal-repair-discovery-coordinator';
import {
    stalkerSessionFingerprint,
    StalkerSessionStore,
    type PersistedStalkerSession,
} from './stalker-session-store';
import { StalkerTokenCache } from './stalker-token-cache';
import { StalkerWatchdogController } from './stalker-watchdog.controller';

export {
    getStalkerPortalIdentityFromPlaylist,
    normalizeStalkerPortalIdentity,
    stalkerIdentityFingerprint,
};
export type { StalkerPortalIdentity };
export type { StalkerEditFence };
export type { StalkerPortalRepairDiscoveryFence };
export type {
    StalkerAuthenticateOptions,
    StalkerAuthenticationResult,
    StalkerHandshakeResponse,
    StalkerPortalCredentials,
    StalkerProfileResponse,
};

export const STALKER_SERIAL_NUMBER = LEGACY_DEFAULT_STALKER_SERIAL;

/**
 * Service to manage Stalker portal session tokens.
 *
 * Handles handshake authentication for playlists in FULL portal mode. Mode is
 * a persisted, behavior-observed fact read through
 * `isFullStalkerPortalPlaylist()` — never a URL substring: since endpoint
 * discovery, a token-enforcing `portal.php` panel is a full portal and a
 * `server/load.php` endpoint that answers without a token is a simple one.
 *
 * Tokens are cached in-run and written back to the playlist row, so a session
 * survives a restart; both are tagged with the identity fingerprint they were
 * negotiated for. Re-authenticates on auth failures.
 */
@Injectable({
    providedIn: 'root',
})
export class StalkerSessionService {
    private dataService = inject(DataService);
    // Lazy: PlaylistsService drags the persistence stack and is only needed
    // when a session is resolved from (or written back to) the stored row.
    private readonly injector = inject(Injector);
    private readonly logger = createLogger('StalkerSession');
    private readonly authApi = new StalkerAuthApi(
        this.dataService,
        this.logger
    );
    readonly performHandshake = this.authApi.performHandshake.bind(
        this.authApi
    );
    readonly getProfile = this.authApi.getProfile.bind(this.authApi);
    readonly doAuth = this.authApi.doAuth.bind(this.authApi);
    readonly authenticate = this.authApi.authenticate.bind(this.authApi);
    private readonly sessionStore = new StalkerSessionStore(
        () => this.injector.get(PlaylistsService),
        this.logger
    );
    private readonly watchdog = new StalkerWatchdogController({
        sendRequest: (playlist, params) =>
            this.makeAuthenticatedRequest(playlist, params, false),
        readPersistedPlaylist: (playlistId) =>
            this.sessionStore.readRow(playlistId),
        logger: this.logger,
    });

    // Session state for this run, identity-tagged so an edited playlist can
    // inherit neither a cached token nor an in-flight authentication.
    private readonly tokens = new StalkerTokenCache();
    private readonly editedSessions = new StalkerEditedSessionCoordinator(
        this.tokens,
        this.watchdog,
        () => this.injector.get(PlaylistsService)
    );
    private readonly portalRepairDiscoveries =
        new StalkerPortalRepairDiscoveryCoordinator(this.tokens);
    private readonly requestClient = new StalkerAuthenticatedRequestClient(
        this.dataService,
        this.tokens,
        (playlist) => this.ensureToken(playlist),
        (playlist, sessionFingerprint) => {
            this.portalRepairDiscoveries.assertAvailable(playlist._id);
            this.editedSessions.assertCurrent(playlist, sessionFingerprint);
        }
    );

    /**
     * Checks if a URL looks like a full stalker portal URL (requires
     * handshake). Delegates to the shared predicate in
     * `@iptvnator/shared/interfaces` — the flag persisted by endpoint
     * discovery is authoritative; this URL rule is only the legacy fallback.
     */
    isFullStalkerPortal(url: string): boolean {
        return isFullStalkerPortalUrl(url);
    }

    /**
     * Gets the cached token for a playlist, or null if not cached.
     * Identity validation happens in `ensureToken`; this raw accessor stays
     * for playback fast paths that cannot supply an identity.
     */
    getCachedToken(playlistId: string): string | null {
        return this.tokens.get(playlistId);
    }

    /**
     * Caches a token together with the identity fingerprint of the playlist
     * the session was negotiated for.
     */
    setCachedToken(
        playlistId: string,
        token: string,
        identitySource: PlaylistMeta
    ): void {
        this.tokens.set(
            playlistId,
            token,
            stalkerSessionFingerprint(identitySource)
        );
    }

    /**
     * Clears the cached token for a playlist (e.g., on auth failure)
     */
    clearCachedToken(playlistId: string): void {
        this.tokens.clear(playlistId);
    }

    /**
     * Lets the repair layer overlay its in-session override on the row a
     * watchdog ping resolves.
     */
    registerWatchdogPlaylistDecorator(
        decorator: (playlist: Playlist) => Playlist
    ): void {
        this.watchdog.registerPlaylistDecorator(decorator);
    }

    /**
     * Sets which playlist should receive periodic watchdog pings.
     * This keeps some Ministra/Stalker sessions alive for live playback.
     * The cadence comes from the portal's profile (`watchdog_timeout` +
     * `timeslot`), defaulting to the documented 120 s.
     */
    setActiveWatchdogPlaylist(playlist?: Playlist | null): void {
        this.watchdog.setActivePlaylist(playlist);
    }

    /**
     * Re-evaluates the watchdog for a playlist whose portal configuration
     * was just repaired. Only reacts when the playlist IS the active
     * watchdog target: a simple→full repair starts the required keepalive,
     * full→simple stops it, and an endpoint change repoints the pings —
     * without waiting for the next route activation.
     *
     * Delegation is the contract: `setActiveWatchdogPlaylist` owns the
     * start/stop/repoint logic, this only feeds it the fresh row.
     */
    refreshActiveWatchdogPlaylist(playlist: Playlist): void {
        if (!this.watchdog.isActivePlaylist(playlist._id)) {
            return;
        }

        this.setActiveWatchdogPlaylist(playlist);
    }

    /**
     * Adopts a session another layer already negotiated — today the endpoint
     * discovery run behind a lazy repair, whose classification handshake and
     * `get_profile` produced both a token and the portal's cadence.
     *
     * Caching the token alone (as the repair used to) leaves the retry
     * satisfied and no authentication path ever applies the profile outcome,
     * so a freshly repaired playlist would keep pinging on the default
     * cadence until the token failed or the app restarted.
     *
     * `identitySource` must describe the REPAIRED configuration: the session
     * belongs to the endpoint it was negotiated against.
     */
    adoptDiscoveredSession(
        playlistId: string,
        identitySource: Playlist,
        session: {
            token: string;
            watchdogTimeoutSeconds?: number;
            timeslotSeconds?: number;
        }
    ): void {
        const fingerprint =
            this.editedSessions.markAuthoritative(identitySource);
        this.setCachedToken(playlistId, session.token, identitySource);
        this.applySessionOutcome(
            playlistId,
            {
                token: session.token,
                reusedStoredToken: false,
                watchdogTimeoutSeconds: session.watchdogTimeoutSeconds,
                timeslotSeconds: session.timeslotSeconds,
            },
            {
                token: identitySource.stalkerToken,
                identityFingerprint: identitySource.stalkerSessionIdentity,
                watchdogTimeoutSeconds: identitySource.stalkerWatchdogTimeout,
                timeslotSeconds: identitySource.stalkerTimeslot,
            },
            fingerprint
        );
    }

    /** Retires a full-portal session after discovery proves a simple portal. */
    adoptDiscoveredSimplePortal(identitySource: Playlist): void {
        this.editedSessions.markAuthoritative(identitySource);
        this.clearCachedToken(identitySource._id);
    }

    /**
     * Reserves the playlist for Edit and drains authentication that began
     * before discovery. The opaque fence keeps new authentication out until
     * the result is either cancelled or atomically persisted.
     */
    beginEditDiscovery(playlist: Playlist): Promise<StalkerEditFence> {
        return this.editedSessions.beginEdit(playlist);
    }

    /**
     * Blocks new runtime authentication while lazy repair probes this
     * playlist, and snapshots authentication that was already in flight so
     * repair can drain it before issuing its own profile request.
     */
    beginPortalRepairDiscovery(
        playlistId: string
    ): StalkerPortalRepairDiscoveryFence {
        return this.portalRepairDiscoveries.begin(playlistId);
    }

    /** Releases the exact lazy-repair authentication owner. */
    completePortalRepairDiscovery(
        fence: StalkerPortalRepairDiscoveryFence
    ): void {
        this.portalRepairDiscoveries.complete(fence);
    }

    /** Releases a discovery reservation whose result will not be saved. */
    cancelEditDiscovery(fence: StalkerEditFence): void {
        this.editedSessions.cancelEdit(fence);
    }

    /**
     * Installs the session produced by explicit Edit discovery. The new
     * fingerprint becomes authoritative only after the atomic row write.
     */
    replaceSessionAfterEdit(
        playlist: Playlist,
        fence?: StalkerEditFence
    ): Promise<Playlist> {
        return this.editedSessions.replace(playlist, fence);
    }

    /**
     * Ensures a valid token exists for a playlist, performing auth if needed.
     * A previously persisted token is re-presented in the handshake first —
     * while it is still the MAC's session token the portal returns it
     * unchanged and the `get_profile` round trip is skipped entirely.
     * Returns the token to use for requests, and the serial number to store.
     */
    async ensureToken(
        playlist: Playlist
    ): Promise<{ token: string | null; serialNumber?: string }> {
        const pendingRepair = this.portalRepairDiscoveries.waitIfPending(
            playlist._id
        );
        if (pendingRepair) {
            await pendingRepair;
        }
        const fingerprint = await this.editedSessions.guard(playlist);
        this.portalRepairDiscoveries.assertAvailable(playlist._id);

        // If not a full stalker portal, no token needed
        if (!isFullStalkerPortalPlaylist(playlist)) {
            return { token: null };
        }

        const identity = getStalkerPortalIdentityFromPlaylist(playlist);
        // One key for both caches: endpoint + identity + credentials. An
        // identity-only in-run key would hand the cached bearer token to a
        // freshly edited endpoint before the persisted check ever ran.
        // Only the session negotiated for THIS identity may be reused.
        const cachedToken = this.tokens.takeFor(playlist._id, fingerprint);
        if (cachedToken) {
            return { token: cachedToken, serialNumber: identity.serialNumber };
        }

        // Check if there's already a pending authentication for this playlist
        // This prevents race conditions when multiple resources request a token simultaneously
        const pendingEntry = this.tokens.getPending(playlist._id);
        if (pendingEntry) {
            if (pendingEntry.identityFingerprint === fingerprint) {
                this.logger.debug('Waiting for pending authentication...');
                return pendingEntry.promise;
            }

            // An authentication for a DIFFERENT (pre-edit) identity is in
            // flight. Its result must not be adopted, but starting a
            // competing handshake would strand it with a dead token on
            // strict portals — wait for it to settle, then re-enter and
            // authenticate as the current identity.
            this.logger.debug(
                'Waiting out an authentication for a different identity...'
            );
            await pendingEntry.promise.catch(() => undefined);
            return this.ensureToken(playlist);
        }

        if (!playlist.portalUrl || !playlist.macAddress) {
            this.logger.error('Missing portal URL or MAC address');
            throw new Error('Portal URL and MAC address are required');
        }
        const portalUrl = playlist.portalUrl;
        const macAddress = playlist.macAddress;

        // guard() may have yielded for a persisted-row authority rebase. An
        // Edit can reserve the playlist before this continuation claims the
        // token slot, so close that final pre-handshake window as well.
        this.editedSessions.assertCurrent(playlist, fingerprint);

        // Create the authentication promise and store it to prevent concurrent auth attempts
        // Use async/await wrapper to properly clean up on both success and failure
        const authPromise = (async () => {
            try {
                // The PERSISTED session is bound to the endpoint too: a
                // playlist repointed at another host must not re-present the
                // previous portal's token to it.
                const stored = await this.sessionStore.read(
                    playlist,
                    fingerprint
                );
                // Repair may have claimed the playlist while the persisted
                // session read yielded. Its fence will drain this published
                // slot; abort before putting another get_profile on the wire.
                this.portalRepairDiscoveries.assertAvailable(playlist._id);
                const result = await this.authenticate(
                    portalUrl,
                    macAddress,
                    identity,
                    {
                        storedToken: stored.token,
                        credentials: {
                            username: playlist.username,
                            password: playlist.password,
                        },
                        // Only skip the profile once the cadence is known. A
                        // playlist stored before the cadence was persisted
                        // has a reusable token and no cadence, and skipping
                        // would strand it on the 120 s default forever — the
                        // profile is the only thing that could teach it. One
                        // request, once; every later start skips.
                        skipProfileWhenReused:
                            stored.watchdogTimeoutSeconds !== undefined,
                    }
                );
                this.portalRepairDiscoveries.assertAvailable(playlist._id);
                this.editedSessions.assertCurrent(playlist, fingerprint);
                this.setCachedToken(playlist._id, result.token, playlist);
                this.applySessionOutcome(
                    playlist._id,
                    result,
                    stored,
                    fingerprint
                );
                return {
                    token: result.token,
                    serialNumber: identity.serialNumber,
                };
            } finally {
                // Clean up pending promise regardless of success/failure
                this.tokens.clearPending(playlist._id);
            }
        })();

        // Store the pending promise so other concurrent requests can wait on it
        this.tokens.setPending(playlist._id, {
            promise: authPromise,
            identityFingerprint: fingerprint,
        });

        return authPromise;
    }

    /**
     * Re-runs handshake + get_profile to read the portal's current account
     * block, sharing `ensureToken()`'s per-playlist serialization.
     *
     * A handshake invalidates the previous token on strict portals, so two
     * overlapping ones leave whichever finishes first holding a dead token.
     * Waiting for any in-flight authentication (and registering this one so
     * later callers wait for it) keeps handshakes sequential; the resulting
     * token replaces the cached one, so catalog and playback requests keep
     * working afterwards.
     */
    async refreshAccountProfile(
        playlist: Playlist
    ): Promise<StalkerProfileResponse['js']['account_info']> {
        if (!playlist.portalUrl || !playlist.macAddress) {
            throw new Error('Portal URL and MAC address are required');
        }

        const pendingRepair = this.portalRepairDiscoveries.waitIfPending(
            playlist._id
        );
        if (pendingRepair) {
            await pendingRepair;
        }
        const portalUrl = playlist.portalUrl;
        const macAddress = playlist.macAddress;
        const identity = getStalkerPortalIdentityFromPlaylist(playlist);
        // One key for both caches: endpoint + identity + credentials. An
        // identity-only in-run key would hand the cached bearer token to a
        // freshly edited endpoint before the persisted check ever ran.
        const fingerprint = await this.editedSessions.guard(playlist);
        this.portalRepairDiscoveries.assertAvailable(playlist._id);

        // Claim the per-playlist slot. Re-check after every await: one
        // settled promise releases every waiter at once, so a single
        // pre-check would let them all start competing handshakes.
        for (
            let inFlight = this.tokens.getPending(playlist._id);
            inFlight;
            inFlight = this.tokens.getPending(playlist._id)
        ) {
            this.logger.debug('Waiting for pending authentication...');
            // A failed pending auth must not abort the refresh; this call
            // performs its own handshake either way.
            await inFlight.promise.catch(() => undefined);
        }
        this.portalRepairDiscoveries.assertAvailable(playlist._id);
        this.editedSessions.assertCurrent(playlist, fingerprint);

        // Publish the slot before the first await so no other waiter can
        // observe it as free while this handshake is starting.
        // No-op defaults: the executor runs synchronously and overwrites
        // both, but the compiler cannot prove that (TS2454).
        let settleSlot: (value: {
            token: string;
            serialNumber?: string;
        }) => void = () => undefined;
        let failSlot: (reason: unknown) => void = () => undefined;
        const slot = new Promise<{ token: string; serialNumber?: string }>(
            (resolve, reject) => {
                settleSlot = resolve;
                failSlot = reject;
            }
        );
        // Waiters attach their own handlers; this one only keeps a
        // rejected slot from surfacing as an unhandled rejection.
        void slot.catch(() => undefined);
        const slotEntry = { promise: slot, identityFingerprint: fingerprint };
        this.tokens.setPending(playlist._id, slotEntry);

        // ensureToken() reads tokenCache before pendingAuth, so leaving the
        // old token there would hand a token this handshake is about to
        // invalidate to catalog and watchdog requests. Retiring it first
        // makes them queue on the slot instead.
        this.clearCachedToken(playlist._id);

        try {
            const result = await this.authenticate(
                portalUrl,
                macAddress,
                identity,
                {
                    credentials: {
                        username: playlist.username,
                        password: playlist.password,
                    },
                }
            );
            this.portalRepairDiscoveries.assertAvailable(playlist._id);
            this.editedSessions.assertCurrent(playlist, fingerprint);
            this.setCachedToken(playlist._id, result.token, playlist);
            // This path always ran a real get_profile, so the decoded cadence
            // is authoritative; the previous values are only the write-back
            // comparison baseline.
            this.applySessionOutcome(
                playlist._id,
                result,
                {
                    token: playlist.stalkerToken,
                    identityFingerprint: playlist.stalkerSessionIdentity,
                    watchdogTimeoutSeconds: playlist.stalkerWatchdogTimeout,
                    timeslotSeconds: playlist.stalkerTimeslot,
                },
                fingerprint
            );
            settleSlot({
                token: result.token,
                serialNumber: identity.serialNumber,
            });
            return result.accountInfo;
        } catch (error) {
            failSlot(error);
            throw error;
        } finally {
            // Only retire our own entry: a caller that started a later
            // authentication owns the map slot from then on.
            this.tokens.clearPendingIf(playlist._id, slotEntry);
        }
    }

    /** Delegates the watchdog + write-back half of an authentication. */
    private applySessionOutcome(
        playlistId: string,
        result: StalkerAuthenticationResult,
        stored: PersistedStalkerSession,
        fingerprint: string
    ): void {
        this.sessionStore.applyAuthenticationOutcome(
            playlistId,
            result,
            stored,
            fingerprint,
            this.watchdog
        );
    }

    /**
     * Wrapper for making stalker requests with automatic token handling and retry on auth failure
     * This should be used by all stalker API calls to ensure proper auth handling
     */
    async makeAuthenticatedRequest<T>(
        playlist: Playlist,
        params: Record<string, string | number>,
        retryOnAuthFailure = true
    ): Promise<T> {
        return this.requestClient.request<T>(
            playlist,
            params,
            retryOnAuthFailure
        );
    }
}
