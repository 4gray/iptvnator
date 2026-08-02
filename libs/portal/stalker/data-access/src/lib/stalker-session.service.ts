import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    isFullStalkerPortalPlaylist,
    isFullStalkerPortalUrl,
    Playlist,
    PlaylistMeta,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { DataService, PlaylistsService } from '@iptvnator/services';
import { createLogger } from '@iptvnator/portal/shared/util';
import {
    isStalkerAuthFailureMessage,
    isStalkerAuthFailureResponse,
} from './stalker-portal-discovery.utils';
import {
    getStalkerPortalIdentityFromPlaylist,
    LEGACY_DEFAULT_STALKER_SERIAL,
    normalizeStalkerPortalIdentity,
    stalkerIdentityFingerprint,
    type StalkerPortalIdentity,
} from './stalker-identity.utils';

export { getStalkerPortalIdentityFromPlaylist, normalizeStalkerPortalIdentity };
export type { StalkerPortalIdentity };

/**
 * SHA1 hash using native Web Crypto API
 * Produces correct 40-character hex hash matching real Stalker clients
 */
async function sha1(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates SHA1 prehash from MAC address
 * This must match what real Stalker clients send
 */
async function generatePrehash(macAddress: string): Promise<string> {
    // Use MAC address with colons, uppercase - this is what most clients use
    const str = macAddress.toUpperCase();
    return (await sha1(str)).toUpperCase();
}

/**
 * Generates a random string for metrics
 */
function generateRandom(): string {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < 40; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export const STALKER_SERIAL_NUMBER = LEGACY_DEFAULT_STALKER_SERIAL;
const STALKER_WATCHDOG_INTERVAL_MS = 25_000;

export interface StalkerHandshakeResponse {
    js: {
        token: string;
        not_valid?: number;
        random?: string;
    };
}

export interface StalkerProfileResponse {
    js: {
        id?: string;
        name?: string;
        mac?: string;
        status?: number;
        msg?: string;
        block_msg?: string;
        account_info?: {
            login?: string;
            expire_date?: number;
            tariff_plan_name?: string;
            status?: number;
        };
    };
}

interface StalkerAuthConfirmationResponse {
    js?: boolean;
}

/**
 * Service to manage Stalker portal session tokens.
 * Handles handshake authentication for full stalker portals (/stalker_portal/c URLs).
 * Persists tokens during session and handles re-authentication on auth failures.
 */
@Injectable({
    providedIn: 'root',
})
export class StalkerSessionService {
    private dataService = inject(DataService);
    // Lazy: PlaylistsService drags the persistence stack and is only needed
    // when a watchdog ping re-resolves its playlist from the stored row.
    private readonly injector = inject(Injector);
    private readonly logger = createLogger('StalkerSession');

    // In-memory token cache for the current session, keyed by playlist ID
    // and tagged with the identity fingerprint the session was negotiated
    // for — an edited MAC/identity must never inherit the previous token.
    private tokenCache = new Map<
        string,
        { token: string; identityFingerprint: string }
    >();
    private watchdogPlaylistDecorator:
        | ((playlist: Playlist) => Playlist)
        | null = null;

    // Pending authentication promises to prevent race conditions.
    // When multiple requests need a token simultaneously, they all wait for
    // the same auth — but ONLY when they act as the same identity: a result
    // negotiated for a pre-edit identity must not be adopted by requests
    // carrying the edited one.
    private pendingAuth = new Map<
        string,
        {
            promise: Promise<{ token: string; serialNumber?: string }>;
            identityFingerprint: string;
        }
    >();
    private watchdogIntervals = new Map<
        string,
        ReturnType<typeof setInterval>
    >();
    private watchdogPlaylists = new Map<string, Playlist>();
    private watchdogInFlight = new Set<string>();
    private activeWatchdogPlaylistId: string | null = null;

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
     * for playback fast paths that cannot supply an identity (PR 6 scope).
     */
    getCachedToken(playlistId: string): string | null {
        return this.tokenCache.get(playlistId)?.token || null;
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
        this.tokenCache.set(playlistId, {
            token,
            identityFingerprint: stalkerIdentityFingerprint(identitySource),
        });
    }

    /**
     * Lets the repair layer overlay its in-session override on the row a
     * watchdog ping resolves: the persisted row can still carry a
     * pre-repair configuration while persistence is pending (or failed),
     * and pinging that configuration would stop or misdirect the keepalive.
     */
    registerWatchdogPlaylistDecorator(
        decorator: (playlist: Playlist) => Playlist
    ): void {
        this.watchdogPlaylistDecorator = decorator;
    }

    /**
     * Clears the cached token for a playlist (e.g., on auth failure)
     */
    clearCachedToken(playlistId: string): void {
        this.tokenCache.delete(playlistId);
    }

    /**
     * Sets which playlist should receive periodic watchdog pings.
     * This keeps some Ministra/Stalker sessions alive for live playback.
     */
    setActiveWatchdogPlaylist(playlist?: Playlist | null): void {
        const nextPlaylistId = playlist?._id ?? null;

        if (
            this.activeWatchdogPlaylistId &&
            this.activeWatchdogPlaylistId !== nextPlaylistId
        ) {
            this.stopWatchdog(this.activeWatchdogPlaylistId);
        }

        this.activeWatchdogPlaylistId = nextPlaylistId;

        if (
            !playlist ||
            !isFullStalkerPortalPlaylist(playlist) ||
            !playlist.portalUrl ||
            !playlist.macAddress
        ) {
            if (nextPlaylistId) {
                this.stopWatchdog(nextPlaylistId);
            }
            return;
        }

        this.startWatchdog(playlist);
    }

    /**
     * Re-evaluates the watchdog for a playlist whose portal configuration
     * was just repaired. Only reacts when the playlist IS the active
     * watchdog target: a simple→full repair starts the required keepalive,
     * full→simple stops it, and an endpoint change repoints the pings —
     * without waiting for the next route activation (the activation-time
     * snapshot in `watchdogPlaylists` would otherwise stay stale).
     */
    refreshActiveWatchdogPlaylist(playlist: Playlist): void {
        if (this.activeWatchdogPlaylistId !== playlist._id) {
            return;
        }

        this.setActiveWatchdogPlaylist(playlist);
    }

    private startWatchdog(playlist: Playlist): void {
        const playlistId = playlist._id;
        this.watchdogPlaylists.set(playlistId, playlist);

        if (this.watchdogIntervals.has(playlistId)) {
            return;
        }

        void this.sendWatchdogPing(playlistId, '1');

        const intervalId = setInterval(() => {
            void this.sendWatchdogPing(playlistId, '0');
        }, STALKER_WATCHDOG_INTERVAL_MS);

        this.watchdogIntervals.set(playlistId, intervalId);
    }

    private stopWatchdog(playlistId: string): void {
        const intervalId = this.watchdogIntervals.get(playlistId);
        if (intervalId) {
            clearInterval(intervalId);
            this.watchdogIntervals.delete(playlistId);
        }
        this.watchdogPlaylists.delete(playlistId);
        this.watchdogInFlight.delete(playlistId);
    }

    /**
     * The playlist a watchdog ping authenticates as. The persisted row is
     * the source of truth: portal metadata (endpoint, mode, MAC, identity)
     * edited or repaired mid-session must reach the keepalive within one
     * ping cycle — the activation-time snapshot is only the fallback when
     * the row cannot be read.
     */
    private async resolveWatchdogPlaylist(
        playlistId: string
    ): Promise<Playlist | undefined> {
        try {
            const row = await firstValueFrom(
                this.injector
                    .get(PlaylistsService)
                    .getPlaylistById(playlistId)
            );
            if (row) {
                const playlist = row as Playlist;
                // Keep the fallback snapshot fresh for the next cycle.
                this.watchdogPlaylists.set(playlistId, playlist);
                return this.decorateWatchdogPlaylist(playlist);
            }
        } catch {
            // Store unavailable (e.g. isolated tests): keep the snapshot.
        }

        const snapshot = this.watchdogPlaylists.get(playlistId);
        return snapshot ? this.decorateWatchdogPlaylist(snapshot) : snapshot;
    }

    /**
     * Overlays the repair layer's in-session override (when registered) so
     * a ping never authenticates against a configuration a completed repair
     * has already proven broken — even before persistence lands.
     */
    private decorateWatchdogPlaylist(playlist: Playlist): Playlist {
        return this.watchdogPlaylistDecorator
            ? this.watchdogPlaylistDecorator(playlist)
            : playlist;
    }

    private async sendWatchdogPing(
        playlistId: string,
        init: '0' | '1'
    ): Promise<void> {
        if (this.watchdogInFlight.has(playlistId)) {
            return;
        }

        // Claimed BEFORE the row read: it awaits, and two overlapping pings
        // passing the check together would double-fire the keepalive.
        this.watchdogInFlight.add(playlistId);
        try {
            const playlist = await this.resolveWatchdogPlaylist(playlistId);
            if (
                !playlist ||
                !playlist.portalUrl ||
                !playlist.macAddress ||
                !isFullStalkerPortalPlaylist(playlist)
            ) {
                this.stopWatchdog(playlistId);
                return;
            }

            await this.makeAuthenticatedRequest(
                playlist,
                {
                    type: 'watchdog',
                    action: 'get_events',
                    event_active_id: '0',
                    cur_play_type: '0',
                    init,
                    JsHttpRequest: '1-xml',
                },
                false
            );
        } catch (error) {
            // Keep failures non-fatal; next interval can recover after token refresh.
            this.logger.warn('Watchdog ping failed:', error);
        } finally {
            this.watchdogInFlight.delete(playlistId);
        }
    }

    /**
     * Performs handshake to get a session token for a full stalker portal
     * Returns both the token and the random value for use in subsequent requests
     */
    async performHandshake(
        portalUrl: string,
        macAddress: string,
        identity: StalkerPortalIdentity = {}
    ): Promise<{ token: string; random: string }> {
        const normalizedIdentity = normalizeStalkerPortalIdentity(identity);
        const prehash = await generatePrehash(macAddress);

        const params: Record<string, string> = {
            type: 'stb',
            action: 'handshake',
            token: '',
            prehash,
            JsHttpRequest: '1-xml',
        };

        try {
            const response: StalkerHandshakeResponse =
                await this.dataService.sendIpcEvent<StalkerHandshakeResponse>(
                    STALKER_REQUEST,
                    {
                        url: portalUrl,
                        macAddress,
                        params,
                        ...(normalizedIdentity.serialNumber
                            ? { serialNumber: normalizedIdentity.serialNumber }
                            : {}),
                    }
                );

            if (response?.js?.token) {
                return {
                    token: response.js.token,
                    random: response.js.random || generateRandom(),
                };
            }

            this.logger.error('No token in response');
            throw new Error('Handshake failed: No token received');
        } catch (error) {
            this.logger.error('Handshake error:', error);
            throw error;
        }
    }

    /**
     * Gets account profile information to validate the portal and check subscription
     * Based on working implementation from stalker-to-m3u repo
     */
    async getProfile(
        portalUrl: string,
        macAddress: string,
        token: string,
        identity: StalkerPortalIdentity,
        handshakeRandom: string
    ): Promise<StalkerProfileResponse> {
        const normalizedIdentity = normalizeStalkerPortalIdentity(identity);

        // Build metrics JSON matching working app
        const metrics: Record<string, string> = {
            mac: macAddress,
            model: 'MAG250',
            type: 'STB',
            random: handshakeRandom,
            ...(normalizedIdentity.serialNumber
                ? { sn: normalizedIdentity.serialNumber }
                : {}),
        };

        // Generate prehash for get_profile (same as handshake)
        const prehash = await generatePrehash(macAddress);

        // Profile request matching working StalkerTV app
        // auth_second_step=1, includes metrics, prehash, and device_id params
        const params: Record<string, string> = {
            type: 'stb',
            action: 'get_profile',
            hd: '1',
            not_valid_token: '0',
            video_out: 'hdmi',
            auth_second_step: '1',
            num_banks: '2',
            metrics: JSON.stringify(metrics),
            ...(normalizedIdentity.serialNumber
                ? { sn: normalizedIdentity.serialNumber }
                : {}),
            ...(normalizedIdentity.deviceId1
                ? { device_id: normalizedIdentity.deviceId1 }
                : {}),
            ...(normalizedIdentity.deviceId2
                ? { device_id2: normalizedIdentity.deviceId2 }
                : {}),
            ...(normalizedIdentity.signature1
                ? { signature: normalizedIdentity.signature1 }
                : {}),
            ...(normalizedIdentity.signature2
                ? { signature2: normalizedIdentity.signature2 }
                : {}),
            prehash: prehash,
            stb_type: '',
            JsHttpRequest: '1-xml',
        };

        try {
            const response: StalkerProfileResponse =
                await this.dataService.sendIpcEvent<StalkerProfileResponse>(
                    STALKER_REQUEST,
                    {
                        url: portalUrl,
                        macAddress,
                        params,
                        token,
                        ...(normalizedIdentity.serialNumber
                            ? { serialNumber: normalizedIdentity.serialNumber }
                            : {}),
                    }
                );

            return response;
        } catch (error) {
            this.logger.error('Get profile error:', error);
            throw error;
        }
    }

    /**
     * Performs do_auth to authenticate the session after handshake
     */
    async doAuth(
        portalUrl: string,
        macAddress: string,
        token: string
    ): Promise<boolean> {
        const params: Record<string, string> = {
            type: 'stb',
            action: 'do_auth',
            login: '',
            password: '',
            JsHttpRequest: '1-xml',
        };

        try {
            const response =
                await this.dataService.sendIpcEvent<StalkerAuthConfirmationResponse>(
                    STALKER_REQUEST,
                    {
                        url: portalUrl,
                        macAddress,
                        params,
                        token,
                    }
                );

            // do_auth returns { js: true } on success
            if (response?.js === true) {
                return true;
            }

            return false;
        } catch (error) {
            this.logger.error('do_auth error:', error);
            throw error;
        }
    }

    /**
     * Performs full authentication flow: handshake -> get_profile (NO do_auth based on working traces)
     * Returns the token and account info if successful
     */
    async authenticate(
        portalUrl: string,
        macAddress: string,
        identity: StalkerPortalIdentity = {}
    ): Promise<{
        token: string;
        accountInfo?: StalkerProfileResponse['js']['account_info'];
    }> {
        const normalizedIdentity = normalizeStalkerPortalIdentity(identity);

        // Step 1: Handshake to get token and random
        const { token, random } = await this.performHandshake(
            portalUrl,
            macAddress,
            normalizedIdentity
        );

        // Step 2: Get profile to activate token and get account info
        // The random from handshake must be used in auth_second_step
        try {
            const profileResponse = await this.getProfile(
                portalUrl,
                macAddress,
                token,
                normalizedIdentity,
                random
            );

            // Check for profile-level errors
            if (profileResponse?.js?.msg || profileResponse?.js?.block_msg) {
                const errorMsg =
                    profileResponse.js.msg ||
                    profileResponse.js.block_msg ||
                    'Unknown profile error';
                this.logger.error('Profile error:', errorMsg);
                throw new Error(`Profile error: ${errorMsg}`);
            }

            return {
                token,
                accountInfo: profileResponse?.js?.account_info,
            };
        } catch (error) {
            // Profile fetch failed - this is a real error, propagate it
            this.logger.error('Profile fetch failed:', error);
            throw error;
        }
    }

    /**
     * Ensures a valid token exists for a playlist, performing full auth if needed
     * IMPORTANT: Based on working traces, each session needs handshake + get_profile
     * Returns the token to use for requests, and the serial number to store
     */
    async ensureToken(
        playlist: Playlist
    ): Promise<{ token: string | null; serialNumber?: string }> {
        // If not a full stalker portal, no token needed
        if (!isFullStalkerPortalPlaylist(playlist)) {
            return { token: null };
        }

        const identity = getStalkerPortalIdentityFromPlaylist(playlist);

        // Check in-memory cache first (valid for current session only).
        const cached = this.tokenCache.get(playlist._id);
        if (cached) {
            if (
                cached.identityFingerprint ===
                stalkerIdentityFingerprint(playlist)
            ) {
                return {
                    token: cached.token,
                    serialNumber: identity.serialNumber,
                };
            }
            // The cached session was negotiated for a DIFFERENT identity
            // (the playlist was edited): retire it and authenticate as the
            // current one instead of pairing new identity with old session.
            this.clearCachedToken(playlist._id);
        }

        // Check if there's already a pending authentication for this playlist
        // This prevents race conditions when multiple resources request a token simultaneously
        const pendingEntry = this.pendingAuth.get(playlist._id);
        if (pendingEntry) {
            if (
                pendingEntry.identityFingerprint ===
                stalkerIdentityFingerprint(playlist)
            ) {
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

        // No cached token - need to do full authentication (handshake + get_profile)
        // Don't trust stored tokens as they may be from a different session
        if (!playlist.portalUrl || !playlist.macAddress) {
            this.logger.error('Missing portal URL or MAC address');
            throw new Error('Portal URL and MAC address are required');
        }
        const portalUrl = playlist.portalUrl;
        const macAddress = playlist.macAddress;

        // Create the authentication promise and store it to prevent concurrent auth attempts
        // Use async/await wrapper to properly clean up on both success and failure
        const authPromise = (async () => {
            try {
                const { token } = await this.authenticate(
                    portalUrl,
                    macAddress,
                    identity
                );
                this.setCachedToken(playlist._id, token, playlist);
                return { token, serialNumber: identity.serialNumber };
            } finally {
                // Clean up pending promise regardless of success/failure
                this.pendingAuth.delete(playlist._id);
            }
        })();

        // Store the pending promise so other concurrent requests can wait on it
        this.pendingAuth.set(playlist._id, {
            promise: authPromise,
            identityFingerprint: stalkerIdentityFingerprint(playlist),
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

        const portalUrl = playlist.portalUrl;
        const macAddress = playlist.macAddress;
        const identity = getStalkerPortalIdentityFromPlaylist(playlist);

        // Claim the per-playlist slot. Re-check after every await: one
        // settled promise releases every waiter at once, so a single
        // pre-check would let them all start competing handshakes.
        for (
            let inFlight = this.pendingAuth.get(playlist._id);
            inFlight;
            inFlight = this.pendingAuth.get(playlist._id)
        ) {
            this.logger.debug('Waiting for pending authentication...');
            // A failed pending auth must not abort the refresh; this call
            // performs its own handshake either way.
            await inFlight.promise.catch(() => undefined);
        }

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
        const slotEntry = {
            promise: slot,
            identityFingerprint: stalkerIdentityFingerprint(playlist),
        };
        this.pendingAuth.set(playlist._id, slotEntry);

        // ensureToken() reads tokenCache before pendingAuth, so leaving the
        // old token there would hand a token this handshake is about to
        // invalidate to catalog and watchdog requests. Retiring it first
        // makes them queue on the slot instead.
        this.clearCachedToken(playlist._id);

        try {
            const result = await this.authenticate(
                portalUrl,
                macAddress,
                identity
            );
            this.setCachedToken(playlist._id, result.token, playlist);
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
            if (this.pendingAuth.get(playlist._id) === slotEntry) {
                this.pendingAuth.delete(playlist._id);
            }
        }
    }

    /**
     * Clears the cached token only while it is still the one that just
     * failed. A request dispatched with the previous token can see its
     * authorization failure arrive after a profile refresh has already
     * cached a fresh token — deleting blindly would kill that fresh token
     * and trigger a cascade of competing handshakes on strict portals.
     */
    private retireFailedToken(
        playlistId: string,
        failedToken: string | null
    ): void {
        if (failedToken && this.getCachedToken(playlistId) === failedToken) {
            this.clearCachedToken(playlistId);
        }
    }

    /**
     * Checks if a response or error indicates an authorization failure
     */
    private isAuthorizationError(responseOrError: unknown): boolean {
        if (!responseOrError) return false;

        const response = responseOrError as Record<string, unknown>;

        // The complete set of portal auth failures — the plain-text bodies
        // (`Authorization failed.`, `Access denied.`, `Unauthorized
        // request.`) and their JSON-envelope forms. Shared with endpoint
        // discovery and the lazy repair so a phrase one layer classifies as
        // an auth failure cannot be ignored by another: the session would
        // otherwise keep an expired token and every later request fails.
        if (
            isStalkerAuthFailureResponse(responseOrError) ||
            isStalkerAuthFailureMessage(response?.['message'])
        ) {
            return true;
        }

        // HTTP auth codes surviving the IPC boundary only as message text
        // (`HTTP Error 401: …`): the custom `status` property is stripped by
        // ipcRenderer, so the numeric code must be read from the message.
        if (
            typeof response?.['message'] === 'string' &&
            /HTTP Error 40[13]\b/.test(response['message'])
        ) {
            return true;
        }

        // Convert response to string for pattern matching
        const responseStr = JSON.stringify(responseOrError).toLowerCase();

        // Check for "Authorization failed. XX" pattern (like "Authorization failed. 75")
        if (/authorization\s*failed\.?\s*\d*/i.test(responseStr)) {
            return true;
        }

        // Check for common auth failure indicators
        const jsData = response?.['js'] as Record<string, unknown>;
        const errorMessage =
            (response?.['message'] as string)?.toLowerCase?.() ||
            jsData?.['error']?.toString?.().toLowerCase?.() ||
            jsData?.['msg']?.toString?.().toLowerCase?.() ||
            '';

        return (
            errorMessage.includes('authorization') ||
            errorMessage.includes('unauthorized') ||
            errorMessage.includes('auth failed') ||
            errorMessage.includes('invalid token') ||
            response?.['status'] === 401 ||
            jsData?.['error'] === 'Authorization failed'
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
        // Get token (will wait if auth is in progress)
        const { token, serialNumber } = await this.ensureToken(playlist);

        try {
            const response = await this.dataService.sendIpcEvent<T>(
                STALKER_REQUEST,
                {
                    url: playlist.portalUrl,
                    macAddress: playlist.macAddress,
                    params,
                    token,
                    ...(serialNumber ? { serialNumber } : {}),
                }
            );

            // Check for authorization failure in response
            if (this.isAuthorizationError(response)) {
                // Retire the failed token even when not retrying (e.g.
                // watchdog pings): leaving it cached would hand a dead
                // session to the next caller.
                this.retireFailedToken(playlist._id, token);
                if (retryOnAuthFailure && isFullStalkerPortalPlaylist(playlist)) {
                    // Retry once with fresh authentication
                    return this.makeAuthenticatedRequest<T>(
                        playlist,
                        params,
                        false
                    );
                }

                throw new Error('Authorization failed after retry');
            }

            return response;
        } catch (error) {
            // Check if error indicates auth failure
            if (this.isAuthorizationError(error)) {
                // Same rule as above: a failed session is retired even on
                // the no-retry path.
                this.retireFailedToken(playlist._id, token);
                if (
                    retryOnAuthFailure &&
                    isFullStalkerPortalPlaylist(playlist)
                ) {
                    // Retry with a fresh handshake
                    return this.makeAuthenticatedRequest<T>(
                        playlist,
                        params,
                        false
                    );
                }
            }
            throw error;
        }
    }
}
