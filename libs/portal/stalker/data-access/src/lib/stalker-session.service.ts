import { Injectable, inject } from '@angular/core';
import { Playlist, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import { DataService } from '@iptvnator/services';
import {
    getStalkerPortalIdentityFromPlaylist,
    LEGACY_DEFAULT_STALKER_SERIAL,
    normalizeStalkerPortalIdentity,
    type StalkerPortalIdentity,
} from './stalker-identity.utils';

export {
    getStalkerPortalIdentityFromPlaylist,
    normalizeStalkerPortalIdentity,
};
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

    // In-memory token cache for current session (keyed by playlist ID)
    private tokenCache = new Map<string, string>();

    // Pending authentication promises to prevent race conditions
    // When multiple requests need a token simultaneously, they all wait for the same auth
    private pendingAuth = new Map<
        string,
        Promise<{ token: string; serialNumber?: string }>
    >();
    private watchdogIntervals = new Map<string, ReturnType<typeof setInterval>>();
    private watchdogPlaylists = new Map<string, Playlist>();
    private watchdogInFlight = new Set<string>();
    private activeWatchdogPlaylistId: string | null = null;

    /**
     * Checks if a URL is a full stalker portal URL (requires handshake)
     * Full stalker portal URLs contain /stalker_portal/ in the path
     */
    isFullStalkerPortal(url: string): boolean {
        return (
            url.includes('/stalker_portal/') || url.includes('/server/load.php')
        );
    }

    /**
     * Gets the cached token for a playlist, or null if not cached
     */
    getCachedToken(playlistId: string): string | null {
        return this.tokenCache.get(playlistId) || null;
    }

    /**
     * Sets a token in the cache
     */
    setCachedToken(playlistId: string, token: string): void {
        this.tokenCache.set(playlistId, token);
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
            !playlist.isFullStalkerPortal ||
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

    private async sendWatchdogPing(
        playlistId: string,
        init: '0' | '1'
    ): Promise<void> {
        if (this.watchdogInFlight.has(playlistId)) {
            return;
        }

        const playlist = this.watchdogPlaylists.get(playlistId);
        if (
            !playlist ||
            !playlist.portalUrl ||
            !playlist.macAddress ||
            !playlist.isFullStalkerPortal
        ) {
            this.stopWatchdog(playlistId);
            return;
        }

        this.watchdogInFlight.add(playlistId);
        try {
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
            console.warn('[StalkerSession] Watchdog ping failed:', error);
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

            console.error('[StalkerSession] No token in response');
            throw new Error('Handshake failed: No token received');
        } catch (error) {
            console.error('[StalkerSession] Handshake error:', error);
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
            console.error('[StalkerSession] Get profile error:', error);
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
            console.error('[StalkerSession] do_auth error:', error);
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
                console.error('[StalkerSession] Profile error:', errorMsg);
                throw new Error(`Profile error: ${errorMsg}`);
            }

            return {
                token,
                accountInfo: profileResponse?.js?.account_info,
            };
        } catch (error) {
            // Profile fetch failed - this is a real error, propagate it
            console.error('[StalkerSession] Profile fetch failed:', error);
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
        if (!playlist.isFullStalkerPortal) {
            return { token: null };
        }

        const identity = getStalkerPortalIdentityFromPlaylist(playlist);

        // Check in-memory cache first (valid for current session only)
        const cachedToken = this.getCachedToken(playlist._id);
        if (cachedToken) {
            return { token: cachedToken, serialNumber: identity.serialNumber };
        }

        // Check if there's already a pending authentication for this playlist
        // This prevents race conditions when multiple resources request a token simultaneously
        const pendingPromise = this.pendingAuth.get(playlist._id);
        if (pendingPromise) {
            console.log(
                '[StalkerSession] Waiting for pending authentication...'
            );
            return pendingPromise;
        }

        // No cached token - need to do full authentication (handshake + get_profile)
        // Don't trust stored tokens as they may be from a different session
        if (!playlist.portalUrl || !playlist.macAddress) {
            console.error('[StalkerSession] Missing portal URL or MAC address');
            throw new Error('Portal URL and MAC address are required');
        }

        // Create the authentication promise and store it to prevent concurrent auth attempts
        // Use async/await wrapper to properly clean up on both success and failure
        const authPromise = (async () => {
            try {
                const { token } = await this.authenticate(
                    playlist.portalUrl,
                    playlist.macAddress,
                    identity
                );
                this.setCachedToken(playlist._id, token);
                return { token, serialNumber: identity.serialNumber };
            } finally {
                // Clean up pending promise regardless of success/failure
                this.pendingAuth.delete(playlist._id);
            }
        })();

        // Store the pending promise so other concurrent requests can wait on it
        this.pendingAuth.set(playlist._id, authPromise);

        return authPromise;
    }

    /**
     * Checks if a response or error indicates an authorization failure
     */
    private isAuthorizationError(responseOrError: unknown): boolean {
        if (!responseOrError) return false;

        const response = responseOrError as Record<string, unknown>;

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
                if (retryOnAuthFailure && playlist.isFullStalkerPortal) {
                    // Clear cached token to force re-authentication
                    this.clearCachedToken(playlist._id);
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
            if (
                this.isAuthorizationError(error) &&
                retryOnAuthFailure &&
                playlist.isFullStalkerPortal
            ) {
                // Clear cached token and retry with new handshake
                this.clearCachedToken(playlist._id);
                return this.makeAuthenticatedRequest<T>(
                    playlist,
                    params,
                    false
                );
            }
            throw error;
        }
    }
}
