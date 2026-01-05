import { Injectable, inject } from '@angular/core';
import { Playlist, STALKER_REQUEST } from 'shared-interfaces';
import { DataService } from './data.service';

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

/**
 * Deterministic serial number - 13 hex characters
 * Constant value for consistency across all sessions
 */
export const STALKER_SERIAL_NUMBER = 'BEDACD4569BAF';

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

    /**
     * Generates a consistent 64-character device ID from MAC address
     */
    private generateDeviceId(macAddress: string): string {
        // Generate consistent device ID from MAC
        const str = macAddress.toUpperCase().replace(/:/g, '');
        const chars = '0123456789ABCDEF';
        let result = '';
        let seed = 0;
        for (let i = 0; i < str.length; i++) {
            seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
        }
        for (let i = 0; i < 64; i++) {
            seed = (seed * 1103515245 + 12345) >>> 0;
            result += chars[seed % 16];
        }
        return result;
    }

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
     * Performs handshake to get a session token for a full stalker portal
     * Returns both the token and the random value for use in subsequent requests
     */
    async performHandshake(
        portalUrl: string,
        macAddress: string
    ): Promise<{ token: string; random: string }> {
        const prehash = await generatePrehash(macAddress);

        const params: Record<string, string> = {
            type: 'stb',
            action: 'handshake',
            token: '',
            prehash,
            JsHttpRequest: '1-xml',
        };

        const fullUrl = `${portalUrl}?type=stb&action=handshake&token=&prehash=${prehash}&JsHttpRequest=1-xml`;
        console.log('[StalkerSession] Performing handshake...');
        console.log('[StalkerSession] Handshake URL:', fullUrl);
        console.log('[StalkerSession] MAC Address:', macAddress);
        console.log('[StalkerSession] Prehash:', prehash);

        try {
            const response: StalkerHandshakeResponse =
                await this.dataService.sendIpcEvent(STALKER_REQUEST, {
                    url: portalUrl,
                    macAddress,
                    params,
                });

            console.log(
                '[StalkerSession] Handshake response:',
                JSON.stringify(response, null, 2)
            );

            if (response?.js?.token) {
                console.log(
                    '[StalkerSession] Token received:',
                    response.js.token.substring(0, 10) + '...'
                );
                console.log(
                    '[StalkerSession] Random received:',
                    response.js.random
                );
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
        serialNumber: string,
        handshakeRandom: string,
        providedDeviceId1?: string,
        providedDeviceId2?: string,
        providedSignature1?: string,
        providedSignature2?: string
    ): Promise<StalkerProfileResponse> {
        // Use provided device IDs or generate from MAC (64 hex chars each)
        const deviceId1 =
            providedDeviceId1?.trim() || this.generateDeviceId(macAddress);
        const deviceId2 = providedDeviceId2?.trim() || deviceId1;

        // Use provided signatures or empty string (some portals don't require them)
        const signature1 = providedSignature1?.trim() || '';
        const signature2 = providedSignature2?.trim() || '';

        // Build metrics JSON matching working app
        const metrics = {
            mac: macAddress,
            model: 'MAG250',
            type: 'STB',
            random: handshakeRandom,
            sn: serialNumber,
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
            sn: serialNumber,
            device_id: deviceId1,
            device_id2: deviceId2,
            signature: signature1,
            ...(signature2 ? { signature2: signature2 } : {}),
            prehash: prehash,
            stb_type: '',
            JsHttpRequest: '1-xml',
        };

        console.log('[StalkerSession] Getting profile...');
        console.log('[StalkerSession] Profile URL:', portalUrl);
        console.log('[StalkerSession] Token:', token.substring(0, 10) + '...');
        console.log('[StalkerSession] Serial Number:', serialNumber);
        console.log(
            '[StalkerSession] Device ID:',
            deviceId1.substring(0, 16) + '...'
        );
        console.log(
            '[StalkerSession] Signature:',
            signature1 ? signature1.substring(0, 16) + '...' : '(empty)'
        );

        try {
            const response: StalkerProfileResponse =
                await this.dataService.sendIpcEvent(STALKER_REQUEST, {
                    url: portalUrl,
                    macAddress,
                    params,
                    token,
                    serialNumber,
                });

            console.log(
                '[StalkerSession] Profile response:',
                JSON.stringify(response, null, 2)
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
            device_id: '',
            device_id2: '',
            JsHttpRequest: '1-xml',
        };

        console.log('[StalkerSession] Performing do_auth...');
        console.log('[StalkerSession] do_auth URL:', portalUrl);
        console.log('[StalkerSession] Token:', token.substring(0, 10) + '...');

        try {
            const response = await this.dataService.sendIpcEvent(
                STALKER_REQUEST,
                {
                    url: portalUrl,
                    macAddress,
                    params,
                    token,
                }
            );

            console.log(
                '[StalkerSession] do_auth response:',
                JSON.stringify(response, null, 2)
            );

            // do_auth returns { js: true } on success
            if (response?.js === true) {
                console.log('[StalkerSession] do_auth successful');
                return true;
            }

            console.warn('[StalkerSession] do_auth returned:', response?.js);
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
        serialNumber: string,
        deviceId1?: string,
        deviceId2?: string,
        signature1?: string,
        signature2?: string
    ): Promise<{
        token: string;
        accountInfo?: StalkerProfileResponse['js']['account_info'];
    }> {
        console.log('[StalkerSession] Starting full authentication flow...');
        console.log('[StalkerSession] Portal URL:', portalUrl);
        console.log('[StalkerSession] MAC Address:', macAddress);
        console.log('[StalkerSession] Serial Number:', serialNumber);
        console.log(
            '[StalkerSession] Device ID 1:',
            deviceId1
                ? deviceId1.substring(0, 16) + '... (provided)'
                : '(will be auto-generated)'
        );
        console.log(
            '[StalkerSession] Device ID 2:',
            deviceId2
                ? deviceId2.substring(0, 16) + '... (provided)'
                : '(will be auto-generated)'
        );
        console.log(
            '[StalkerSession] Signature 1:',
            signature1
                ? signature1.substring(0, 16) + '... (provided)'
                : '(empty)'
        );
        console.log(
            '[StalkerSession] Signature 2:',
            signature2
                ? signature2.substring(0, 16) + '... (provided)'
                : '(empty)'
        );

        // Step 1: Handshake to get token and random
        console.log('[StalkerSession] Step 1: Performing handshake...');
        const { token, random } = await this.performHandshake(
            portalUrl,
            macAddress
        );
        console.log(
            '[StalkerSession] Step 1 complete: Token and random obtained'
        );

        // Step 2: Get profile to activate token and get account info
        // The random from handshake must be used in auth_second_step
        console.log(
            '[StalkerSession] Step 2: Getting profile with handshake random (activates token)...'
        );
        try {
            const profileResponse = await this.getProfile(
                portalUrl,
                macAddress,
                token,
                serialNumber,
                random,
                deviceId1,
                deviceId2,
                signature1,
                signature2
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

            console.log(
                '[StalkerSession] Step 2 complete: Profile obtained, token activated'
            );
            console.log('[StalkerSession] Authentication successful!');
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
        console.log(
            '[StalkerSession] Ensuring token for playlist:',
            playlist._id
        );
        console.log(
            '[StalkerSession] Is full stalker portal:',
            playlist.isFullStalkerPortal
        );

        // If not a full stalker portal, no token needed
        if (!playlist.isFullStalkerPortal) {
            console.log(
                '[StalkerSession] Not a full stalker portal, no token needed'
            );
            return { token: null };
        }

        // Check in-memory cache first (valid for current session only)
        const cachedToken = this.getCachedToken(playlist._id);
        if (cachedToken) {
            console.log(
                '[StalkerSession] Using cached token:',
                cachedToken.substring(0, 10) + '...'
            );
            return { token: cachedToken };
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

        // Get or generate serial number - must be consistent for the MAC
        let serialNumber = playlist.stalkerSerialNumber;
        if (!serialNumber) {
            serialNumber = STALKER_SERIAL_NUMBER;
            console.log(
                '[StalkerSession] Generated new serial number:',
                serialNumber
            );
        } else {
            console.log(
                '[StalkerSession] Using stored serial number:',
                serialNumber
            );
        }

        console.log(
            '[StalkerSession] No cached token, performing full authentication...'
        );

        // Create the authentication promise and store it to prevent concurrent auth attempts
        // Use async/await wrapper to properly clean up on both success and failure
        const authPromise = (async () => {
            try {
                const { token } = await this.authenticate(
                    playlist.portalUrl,
                    playlist.macAddress,
                    serialNumber
                );
                console.log(
                    '[StalkerSession] Authentication complete, token cached'
                );
                this.setCachedToken(playlist._id, token);
                return { token, serialNumber };
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
        const { token } = await this.ensureToken(playlist);
        const serialNumber = playlist.stalkerSerialNumber;

        console.log(
            '[StalkerSession] Making authenticated request:',
            params['action']
        );

        try {
            const response = await this.dataService.sendIpcEvent(
                STALKER_REQUEST,
                {
                    url: playlist.portalUrl,
                    macAddress: playlist.macAddress,
                    params,
                    token,
                    serialNumber,
                }
            );

            // Check for authorization failure in response
            if (this.isAuthorizationError(response)) {
                console.warn(
                    '[StalkerSession] Authorization error detected in response:',
                    response
                );

                if (retryOnAuthFailure && playlist.isFullStalkerPortal) {
                    console.log(
                        '[StalkerSession] Clearing token and retrying with fresh auth...'
                    );
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
                console.log(
                    '[StalkerSession] Clearing token and retrying with fresh auth (caught error)...'
                );
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
