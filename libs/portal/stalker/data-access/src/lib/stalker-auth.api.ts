import type { DataService } from '@iptvnator/services';
import {
    extractStalkerAuthFailureBody,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import type { createLogger } from '@iptvnator/portal/shared/util';
import {
    normalizeStalkerPortalIdentity,
    type StalkerPortalIdentity,
} from './stalker-identity.utils';
import {
    combineStalkerPortalMessages,
    StalkerPortalError,
} from './stalker-portal-error';

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
        /** Watchdog cadence in seconds, echoed by the portal (default 120). */
        watchdog_timeout?: number | string;
        /** Per-user jitter in seconds so watchdog pings do not align. */
        timeslot?: number | string;
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

export interface StalkerPortalCredentials {
    username?: string;
    password?: string;
}

export interface StalkerAuthenticateOptions {
    /**
     * Previously persisted session token. The handshake is idempotent: it is
     * re-presented, and the portal returns it unchanged while it is still the
     * MAC's session token.
     */
    storedToken?: string;
    /** Login/password for portals that answer `get_profile` with status 2. */
    credentials?: StalkerPortalCredentials;
    /**
     * Skip the `get_profile` round trip when the stored token came back
     * unchanged — an unchanged token is already an adopted session.
     */
    skipProfileWhenReused?: boolean;
    /**
     * Abandons the flow between portal calls.
     *
     * This is what a timed-out discovery attempt needs: `get_profile` is the
     * call that adopts a token for the MAC portal-side, so an abandoned
     * attempt reaching it AFTER another candidate authenticated would
     * invalidate that healthy candidate's token. Checking the signal before
     * each call stops the request from being sent, which is the only thing
     * that prevents it — a request already on the wire is processed by the
     * server whether or not the client tears the socket down.
     */
    signal?: AbortSignal;
}

export interface StalkerAuthenticationResult {
    token: string;
    accountInfo?: StalkerProfileResponse['js']['account_info'];
    /**
     * Raw envelope so callers can apply their own failure checks — endpoint
     * discovery rejects a candidate whose `get_profile` refuses even though
     * the handshake succeeded. Absent when the stored token was reused and
     * no profile was fetched.
     */
    profileResponse?: StalkerProfileResponse;
    /** True when the stored token was accepted and `get_profile` was skipped. */
    reusedStoredToken?: boolean;
    watchdogTimeoutSeconds?: number;
    timeslotSeconds?: number;
}

interface StalkerHandshakeOutcome {
    token: string;
    random: string;
    /** The portal flagged the presented stored token as no longer valid. */
    notValid: boolean;
}

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

function toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

/** Raised when a caller abandoned the flow between portal calls. */
export class StalkerAuthAbortedError extends Error {
    constructor() {
        super('Stalker authentication was aborted');
        this.name = 'StalkerAuthAbortedError';
    }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        throw new StalkerAuthAbortedError();
    }
}

/**
 * Throws when a response is one of the portal's plain-text auth-failure
 * bodies (already classified by the transport, or still raw on legacy paths).
 */
function assertNotAuthFailure(response: unknown): void {
    const failureBody = extractStalkerAuthFailureBody(response);
    if (failureBody) {
        throw new StalkerPortalError('auth-failed', failureBody, failureBody);
    }
}

/**
 * Raw Stalker authentication requests plus the documented login flow.
 *
 * Protocol (Stalker 4.9.35): `handshake` issues an idempotent token;
 * `get_profile` turns it into a session and decodes as: full profile = OK,
 * `status: 1` = blocked (see `msg`/`block_msg`), `status: 2` = login/password
 * required → `do_auth`, then `get_profile` again with `auth_second_step=1`.
 */
export class StalkerAuthApi {
    constructor(
        private readonly dataService: DataService,
        private readonly logger: ReturnType<typeof createLogger>
    ) {}

    async performHandshake(
        portalUrl: string,
        macAddress: string,
        identity: StalkerPortalIdentity = {},
        storedToken?: string,
        signal?: AbortSignal
    ): Promise<StalkerHandshakeOutcome> {
        const normalizedIdentity = normalizeStalkerPortalIdentity(identity);
        const prehash = await generatePrehash(macAddress);

        const params: Record<string, string> = {
            type: 'stb',
            action: 'handshake',
            // Re-presenting a persisted token is how a real client resumes a
            // session: an idempotent portal returns it unchanged.
            token: storedToken ?? '',
            prehash,
            JsHttpRequest: '1-xml',
        };

        try {
            // Re-checked here rather than only at the call site: the prehash
            // above is async, so an abort can land while it is being
            // computed and the request would still go out.
            assertNotAborted(signal);
            const response =
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

            assertNotAuthFailure(response);

            if (response?.js?.token) {
                return {
                    token: response.js.token,
                    random: response.js.random || generateRandom(),
                    notValid: Number(response.js.not_valid ?? 0) === 1,
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
     * Gets account profile information to validate the portal and check
     * subscription. `authSecondStep` is set only on the retry after `do_auth`;
     * `notValidToken` propagates the handshake's `not_valid` flag.
     */
    async getProfile(
        portalUrl: string,
        macAddress: string,
        token: string,
        identity: StalkerPortalIdentity,
        handshakeRandom: string,
        options: {
            authSecondStep?: boolean;
            notValidToken?: boolean;
            signal?: AbortSignal;
        } = {}
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

        const params: Record<string, string> = {
            type: 'stb',
            action: 'get_profile',
            hd: '1',
            not_valid_token: options.notValidToken ? '1' : '0',
            video_out: 'hdmi',
            auth_second_step: options.authSecondStep ? '1' : '0',
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
            // The last possible moment before the call that adopts the MAC's
            // token portal-side — the prehash above is async, so the caller's
            // pre-check can be stale by now.
            assertNotAborted(options.signal);
            const response =
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

            assertNotAuthFailure(response);
            return response;
        } catch (error) {
            this.logger.error('Get profile error:', error);
            throw error;
        }
    }

    /**
     * Performs `do_auth` — the login/password step behind `get_profile`
     * status 2. Returns the portal's bare boolean verdict.
     */
    async doAuth(
        portalUrl: string,
        macAddress: string,
        token: string,
        credentials: StalkerPortalCredentials,
        identity: StalkerPortalIdentity = {},
        signal?: AbortSignal
    ): Promise<boolean> {
        const normalizedIdentity = normalizeStalkerPortalIdentity(identity);
        const params: Record<string, string> = {
            type: 'stb',
            action: 'do_auth',
            login: credentials.username ?? '',
            password: credentials.password ?? '',
            ...(normalizedIdentity.deviceId1
                ? { device_id: normalizedIdentity.deviceId1 }
                : {}),
            ...(normalizedIdentity.deviceId2
                ? { device_id2: normalizedIdentity.deviceId2 }
                : {}),
            JsHttpRequest: '1-xml',
        };

        try {
            assertNotAborted(signal);
            const response =
                await this.dataService.sendIpcEvent<StalkerAuthConfirmationResponse>(
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

            assertNotAuthFailure(response);

            // do_auth returns { js: true } on success
            return response?.js === true;
        } catch (error) {
            this.logger.error('do_auth error:', error);
            throw error;
        }
    }

    /**
     * Full authentication flow: handshake → (optional token reuse) →
     * get_profile → (status 2 → do_auth → get_profile with
     * auth_second_step=1) → decoded profile.
     */
    async authenticate(
        portalUrl: string,
        macAddress: string,
        identity: StalkerPortalIdentity = {},
        options: StalkerAuthenticateOptions = {}
    ): Promise<StalkerAuthenticationResult> {
        const normalizedIdentity = normalizeStalkerPortalIdentity(identity);

        assertNotAborted(options.signal);
        const handshake = await this.performHandshake(
            portalUrl,
            macAddress,
            normalizedIdentity,
            options.storedToken,
            options.signal
        );

        // An unchanged stored token is already an adopted session — the
        // profile round trip is what token persistence saves. `not_valid`
        // vetoes that shortcut: it is the portal saying the presented token
        // is not a live session, and adopting it anyway would be
        // unrecoverable — nothing writes a new token back, so every later
        // start would re-present the same dead one.
        if (
            options.skipProfileWhenReused &&
            options.storedToken &&
            !handshake.notValid &&
            handshake.token === options.storedToken
        ) {
            return { token: handshake.token, reusedStoredToken: true };
        }

        // The abandoned-attempt guard that matters: this is the call that
        // adopts the token for the MAC portal-side.
        assertNotAborted(options.signal);
        const profile = await this.getProfile(
            portalUrl,
            macAddress,
            handshake.token,
            normalizedIdentity,
            handshake.random,
            {
                authSecondStep: false,
                notValidToken: handshake.notValid,
                signal: options.signal,
            }
        );

        // The envelope the login flow actually settled on: after a status-2
        // `do_auth` that is the RETRIED profile, not the first one.
        const profileResponse = await this.resolveProfile(
            profile,
            portalUrl,
            macAddress,
            handshake,
            normalizedIdentity,
            options
        );
        const resolved = profileResponse?.js;

        return {
            token: handshake.token,
            accountInfo: resolved?.account_info,
            profileResponse,
            reusedStoredToken: false,
            watchdogTimeoutSeconds: toFiniteNumber(resolved?.watchdog_timeout),
            timeslotSeconds: toFiniteNumber(resolved?.timeslot),
        };
    }

    /**
     * Decodes `js.status` and drives the status-2 login flow. Throws a
     * `StalkerPortalError` carrying the portal's own `msg`/`block_msg` text
     * when the portal refused the session.
     */
    private async resolveProfile(
        profile: StalkerProfileResponse,
        portalUrl: string,
        macAddress: string,
        handshake: StalkerHandshakeOutcome,
        identity: StalkerPortalIdentity,
        options: StalkerAuthenticateOptions
    ): Promise<StalkerProfileResponse> {
        let settled = profile;
        let js = profile?.js;

        // Portals routinely stringify numeric fields (the same reason
        // `watchdog_timeout`/`timeslot` are typed `number | string`), so a
        // strict `=== 2` would read `"2"` as a healthy profile and skip the
        // whole login flow.
        if (toFiniteNumber(js?.status) === 2) {
            // The portal's own sentence travels WITH the refusal — "wrong
            // password", "subscription expired", "contact your provider" —
            // and reading it is the whole reason these errors carry
            // `portalText`. It is read at each exit rather than once up
            // front because `js` advances to the retry's response below: the
            // second refusal explains itself, and quoting the first one back
            // would describe a request that already succeeded.
            const loginText = () =>
                combineStalkerPortalMessages(js?.msg, js?.block_msg);
            const username = options.credentials?.username?.trim() ?? '';
            const password = options.credentials?.password ?? '';
            if (!username || !password) {
                throw new StalkerPortalError('login-required', loginText());
            }

            assertNotAborted(options.signal);
            const accepted = await this.doAuth(
                portalUrl,
                macAddress,
                handshake.token,
                { username, password },
                identity,
                options.signal
            );
            if (!accepted) {
                // `do_auth` answers a bare `{js: false}`, so the only text
                // available here is the profile's — which is the one that
                // asked for the login in the first place.
                throw new StalkerPortalError('login-rejected', loginText());
            }

            assertNotAborted(options.signal);
            const retried = await this.getProfile(
                portalUrl,
                macAddress,
                handshake.token,
                identity,
                handshake.random,
                {
                    authSecondStep: true,
                    notValidToken: handshake.notValid,
                    signal: options.signal,
                }
            );
            settled = retried;
            js = retried?.js;
            if (toFiniteNumber(js?.status) === 2) {
                throw new StalkerPortalError('login-rejected', loginText());
            }
        }

        const portalText = combineStalkerPortalMessages(
            js?.msg,
            js?.block_msg
        );

        if (toFiniteNumber(js?.status) === 1 || portalText) {
            this.logger.error('Profile error:', portalText ?? 'status 1');
            throw new StalkerPortalError('blocked', portalText);
        }

        return settled;
    }
}
