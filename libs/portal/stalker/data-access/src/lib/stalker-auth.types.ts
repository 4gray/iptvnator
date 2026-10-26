import type { StalkerRequestOptions } from './stalker-request-options';

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

export interface StalkerAuthConfirmationResponse {
    js?: boolean;
}

export interface StalkerPortalCredentials {
    username?: string;
    password?: string;
}

export interface StalkerAuthenticateOptions extends StalkerRequestOptions {
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

export interface StalkerHandshakeOutcome {
    token: string;
    random: string;
    /** The portal flagged the presented stored token as no longer valid. */
    notValid: boolean;
}
