import {
    STALKER_FAILURE_REASONS,
    classifyStalkerDoAuth,
    classifyStalkerProfile,
    classifyStalkerResponseFailure,
    parseStalkerResponseEnvelope,
    type StalkerIdentityProfile,
} from '@iptvnator/portal/stalker/protocol';
import type {
    StalkerSessionAccountSummary,
    StalkerSessionFailureReason,
    StalkerSessionStage,
} from '@iptvnator/shared/interfaces';
import type { StalkerEndpointFullSessionOutcome } from './stalker-endpoint-resolver';
import {
    STALKER_HTTP_OUTCOME_KINDS,
    STALKER_HTTP_REQUEST_MODES,
    StalkerHttpSession,
    type StalkerHttpRequest,
    type StalkerHttpRequestOutcome,
} from './stalker-http-session';
import type {
    StalkerTransportConfig,
    StalkerTransportResult,
} from './stalker-session.types';
import type { StalkerCookieJar } from './stalker-cookie-jar';

const USERNAME_MAX_BYTES = 512;
const PASSWORD_MAX_BYTES = 2048;
const STALKER_STREAM_USER_AGENT = 'KSPlayer';

interface StalkerHttpSessionLike {
    request(request: StalkerHttpRequest): Promise<StalkerHttpRequestOutcome>;
}

export interface StalkerAuthSessionDependencies {
    createHttpSession?: (
        resolved: StalkerEndpointFullSessionOutcome,
        transport: StalkerTransportConfig
    ) => StalkerHttpSessionLike;
}

export interface StalkerPreparedPlayback {
    readonly headers: Readonly<Record<string, string>>;
    readonly streamUrl: string;
}

export interface StalkerAuthCredentials {
    password: string;
    username: string;
}

export interface StalkerAuthReadyOutcome {
    accountSummary?: StalkerSessionAccountSummary;
    kind: 'ready';
    watchdogIntervalSeconds?: number;
}

export interface StalkerAuthCredentialsRequiredOutcome {
    attemptNumber: number;
    kind: 'credentials-required';
    savedCredentialsRejected?: boolean;
}

export interface StalkerAuthFailureOutcome {
    kind: 'failure';
    reason: StalkerSessionFailureReason;
    retryable: boolean;
    retryAfterSeconds?: number;
    stage: StalkerSessionStage;
}

export interface StalkerAuthOriginApprovalOutcome {
    finalOrigin: string;
    kind: 'origin-approval-required';
    sourceOrigin: string;
    targetUrl: string;
}

export type StalkerAuthOutcome =
    | StalkerAuthReadyOutcome
    | StalkerAuthCredentialsRequiredOutcome
    | StalkerAuthFailureOutcome
    | StalkerAuthOriginApprovalOutcome;

export type StalkerAuthenticatedRequestOutcome =
    | { kind: 'success'; value: unknown }
    | { kind: 'token-rejected' }
    | StalkerAuthFailureOutcome
    | StalkerAuthOriginApprovalOutcome;

type AuthState = 'new' | 'awaiting-credentials' | 'ready' | 'failed';

export class StalkerAuthSession {
    readonly #cookieJar: StalkerCookieJar;
    readonly #endpoint: string;
    readonly #http: StalkerHttpSessionLike;
    readonly #identity: StalkerIdentityProfile;
    readonly #token: string;
    #acceptedCredentials: StalkerAuthCredentials | undefined;
    #credentialAttempts = 0;
    #lastOutcome: StalkerAuthOutcome | undefined;
    #principalKey = 'mac-only';
    #profile: Readonly<Record<string, unknown>>;
    #state: AuthState = 'new';

    constructor(
        resolved: StalkerEndpointFullSessionOutcome,
        transport: StalkerTransportConfig,
        dependencies: StalkerAuthSessionDependencies = {}
    ) {
        this.#cookieJar = resolved.cookieJar;
        this.#endpoint = resolved.endpoint;
        this.#identity = resolved.identity;
        this.#profile = resolved.profile.profile;
        this.#token = resolved.token;
        this.#http =
            dependencies.createHttpSession?.(resolved, transport) ??
            new StalkerHttpSession(resolved.cookieJar, transport);
        if (resolved.profile.kind === 'ready') {
            this.#principalKey =
                readNonEmptyString(resolved.profile.profile['login']) ??
                'mac-only';
        }
    }

    async start(
        savedCredentials?: StalkerAuthCredentials
    ): Promise<StalkerAuthOutcome> {
        if (this.#state !== 'new') {
            return (
                this.#lastOutcome ??
                authFailure(
                    STALKER_FAILURE_REASONS.IncompatibleResponse,
                    'profile-first',
                    false
                )
            );
        }

        const initialProfile = classifyStalkerProfile({
            js: this.#profile,
        });
        if (initialProfile.kind === 'ready') {
            return this.markReady(initialProfile.profile);
        }
        if (initialProfile.kind === 'blocked') {
            return this.markFailed(
                authFailure(
                    STALKER_FAILURE_REASONS.AccountOrDeviceBlocked,
                    'profile-first',
                    false
                )
            );
        }
        if (initialProfile.kind === 'failure') {
            return this.markFailed(
                authFailure(initialProfile.reason, 'profile-first', false)
            );
        }

        this.#state = 'awaiting-credentials';
        if (savedCredentials !== undefined) {
            return this.submitCredentials(savedCredentials, true);
        }
        return this.setOutcome({
            attemptNumber: 1,
            kind: 'credentials-required',
        });
    }

    async submitCredentials(
        credentials: StalkerAuthCredentials,
        savedCredentials = false
    ): Promise<StalkerAuthOutcome> {
        if (this.#state !== 'awaiting-credentials') {
            return authFailure(
                STALKER_FAILURE_REASONS.IncompatibleResponse,
                'do-auth',
                false
            );
        }
        const normalized = normalizeCredentials(credentials);
        if (normalized === null) {
            return authFailure(
                STALKER_FAILURE_REASONS.InvalidIdentityInput,
                'do-auth',
                false
            );
        }
        if (this.#credentialAttempts >= 3) {
            return this.markFailed(
                authFailure(
                    STALKER_FAILURE_REASONS.CredentialsAttemptLimit,
                    'do-auth',
                    false
                )
            );
        }

        this.#credentialAttempts += 1;
        const doAuth = await this.#http.request({
            headers: this.authenticatedHeaders(),
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: {
                action: 'do_auth',
                JsHttpRequest: '1-xml',
                login: normalized.username,
                password: normalized.password,
                type: 'stb',
            },
            url: this.#endpoint,
        });
        const normalizedDoAuth = normalizeResponse(doAuth, 'do-auth');
        if (normalizedDoAuth.kind !== 'success') {
            return this.markFailed(normalizedDoAuth);
        }

        const doAuthClassification = classifyStalkerDoAuth(
            normalizedDoAuth.value
        );
        if (doAuthClassification.kind === 'credentials-rejected') {
            return this.handleCredentialRejection(savedCredentials);
        }
        if (doAuthClassification.kind === 'failure') {
            return this.markFailed(
                authFailure(doAuthClassification.reason, 'do-auth', false)
            );
        }

        const secondProfile = await this.#http.request({
            headers: this.authenticatedHeaders(),
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: {
                ...this.#identity.profileParameters,
                action: 'get_profile',
                auth_second_step: 1,
                JsHttpRequest: '1-xml',
                metrics: JSON.stringify(this.#identity.metrics),
                not_valid_token: 0,
                type: 'stb',
            },
            url: this.#endpoint,
        });
        const normalizedSecondProfile = normalizeResponse(
            secondProfile,
            'profile-second'
        );
        if (normalizedSecondProfile.kind !== 'success') {
            return this.markFailed(normalizedSecondProfile);
        }
        const classifiedProfile = classifyStalkerProfile(
            normalizedSecondProfile.value
        );
        if (classifiedProfile.kind === 'blocked') {
            return this.markFailed(
                authFailure(
                    STALKER_FAILURE_REASONS.AccountOrDeviceBlocked,
                    'profile-second',
                    false
                )
            );
        }
        if (classifiedProfile.kind === 'failure') {
            return this.markFailed(
                authFailure(classifiedProfile.reason, 'profile-second', false)
            );
        }
        if (classifiedProfile.kind === 'credentials-required') {
            return this.handleCredentialRejection(savedCredentials);
        }

        this.#acceptedCredentials = normalized;
        this.#principalKey =
            readNonEmptyString(classifiedProfile.profile['login']) ??
            normalized.username;
        return this.markReady(classifiedProfile.profile);
    }

    getPrincipalKey(): string {
        return this.#principalKey;
    }

    getEndpoint(): string {
        return this.#endpoint;
    }

    hasAcceptedCredentials(): boolean {
        return this.#acceptedCredentials !== undefined;
    }

    async preparePlayback(streamUrl: string): Promise<StalkerPreparedPlayback> {
        if (this.#state !== 'ready') {
            throw new Error('stalker-playback-not-ready');
        }

        const normalizedUrl = normalizePlaybackUrl(streamUrl, this.#endpoint);
        if (new URL(normalizedUrl).origin !== new URL(this.#endpoint).origin) {
            return {
                headers: {
                    Accept: '*/*',
                    Connection: 'keep-alive',
                    'Icy-MetaData': '1',
                    Range: 'bytes=0-',
                    'User-Agent': STALKER_STREAM_USER_AGENT,
                },
                streamUrl: normalizedUrl,
            };
        }

        const cookie = await this.#cookieJar.getCookieHeader(normalizedUrl);
        return {
            headers: {
                ...this.#identity.headers,
                Authorization: `Bearer ${this.#token}`,
                ...(cookie ? { Cookie: cookie } : {}),
            },
            streamUrl: normalizedUrl,
        };
    }

    async request(
        parameters: Readonly<Record<string, string | number>>
    ): Promise<StalkerAuthenticatedRequestOutcome> {
        if (this.#state !== 'ready') {
            return authFailure(
                STALKER_FAILURE_REASONS.IncompatibleResponse,
                'ready',
                false
            );
        }
        const outcome = await this.#http.request({
            headers: this.authenticatedHeaders(),
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: parameters,
            url: this.#endpoint,
        });
        return normalizeResponse(outcome, 'ready', true);
    }

    private authenticatedHeaders(): Readonly<Record<string, string>> {
        return {
            ...this.#identity.headers,
            Authorization: `Bearer ${this.#token}`,
        };
    }

    private handleCredentialRejection(
        savedCredentials: boolean
    ): StalkerAuthOutcome {
        if (this.#credentialAttempts >= 3) {
            return this.markFailed(
                authFailure(
                    STALKER_FAILURE_REASONS.CredentialsAttemptLimit,
                    'do-auth',
                    false
                )
            );
        }
        this.#state = 'awaiting-credentials';
        return this.setOutcome({
            attemptNumber: this.#credentialAttempts + 1,
            kind: 'credentials-required',
            ...(savedCredentials ? { savedCredentialsRejected: true } : {}),
        });
    }

    private markReady(
        profile: Readonly<Record<string, unknown>>
    ): StalkerAuthReadyOutcome {
        this.#profile = profile;
        this.#state = 'ready';
        return this.setOutcome(buildReadyOutcome(profile));
    }

    private markFailed(
        outcome:
            | StalkerAuthFailureOutcome
            | StalkerAuthOriginApprovalOutcome
            | { kind: 'token-rejected' }
    ): StalkerAuthOutcome {
        const failure =
            outcome.kind === 'token-rejected'
                ? authFailure(
                      STALKER_FAILURE_REASONS.AuthRefreshExhausted,
                      'refreshing',
                      false
                  )
                : outcome;
        this.#state = 'failed';
        return this.setOutcome(failure);
    }

    private setOutcome<Outcome extends StalkerAuthOutcome>(
        outcome: Outcome
    ): Outcome {
        this.#lastOutcome = outcome;
        return outcome;
    }
}

function normalizePlaybackUrl(value: string, endpoint: string): string {
    if (
        typeof value !== 'string' ||
        value.trim() === '' ||
        value.length > 16 * 1024
    ) {
        throw new Error('stalker-playback-invalid-url');
    }
    const trimmed = value.trim();
    const separator = trimmed.indexOf(' ');
    const command =
        separator > 0 ? trimmed.slice(separator + 1).trim() : trimmed;
    let url: URL;
    try {
        url = new URL(command, endpoint);
    } catch {
        throw new Error('stalker-playback-invalid-url');
    }
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== ''
    ) {
        throw new Error('stalker-playback-invalid-url');
    }
    url.hash = '';
    return url.toString();
}

function normalizeResponse(
    outcome: StalkerHttpRequestOutcome,
    stage: StalkerSessionStage,
    allowTokenRejection = false
): StalkerAuthenticatedRequestOutcome {
    if (outcome.kind === STALKER_HTTP_OUTCOME_KINDS.Failure) {
        return authFailure(outcome.reason, stage, outcome.retryable);
    }
    if (outcome.kind === STALKER_HTTP_OUTCOME_KINDS.OriginApprovalRequired) {
        return {
            finalOrigin: outcome.finalOrigin,
            kind: 'origin-approval-required',
            sourceOrigin: outcome.sourceOrigin,
            targetUrl: outcome.targetUrl,
        };
    }

    const parsed = parseResult(outcome.result);
    const classifiedFailure = classifyStalkerResponseFailure({
        httpStatus: outcome.result.status,
        rawBody: parsed.rawBody,
        value: parsed.value,
    });
    if (classifiedFailure.kind === 'failure') {
        return authFailure(
            classifiedFailure.reason,
            stage,
            isRetryableFailure(classifiedFailure.reason),
            outcome.result.retryAfterSeconds
        );
    }
    if (classifiedFailure.kind === 'token-rejected') {
        return allowTokenRejection
            ? { kind: 'token-rejected' }
            : authFailure(
                  STALKER_FAILURE_REASONS.IncompatibleResponse,
                  stage,
                  false
              );
    }
    if (outcome.result.status !== 200 || parsed.value === undefined) {
        return authFailure(
            STALKER_FAILURE_REASONS.IncompatibleResponse,
            stage,
            false
        );
    }
    return { kind: 'success', value: parsed.value };
}

function parseResult(result: StalkerTransportResult<Uint8Array>): {
    rawBody?: string;
    value?: unknown;
} {
    let rawBody: string;
    try {
        rawBody = new TextDecoder('utf-8', { fatal: true }).decode(result.body);
    } catch {
        return {};
    }
    const parsed = parseStalkerResponseEnvelope({
        body: rawBody,
        contentType: result.contentType,
        maxBodyBytes: result.body.byteLength,
    });
    return parsed.kind === 'parsed'
        ? { rawBody, value: parsed.value }
        : { rawBody };
}

function normalizeCredentials(
    value: StalkerAuthCredentials
): StalkerAuthCredentials | null {
    if (
        typeof value?.username !== 'string' ||
        typeof value?.password !== 'string'
    ) {
        return null;
    }
    const username = value.username.trim();
    const password = value.password;
    if (
        username.length === 0 ||
        password.length === 0 ||
        Buffer.byteLength(username, 'utf8') > USERNAME_MAX_BYTES ||
        Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES
    ) {
        return null;
    }
    return { password, username };
}

function buildReadyOutcome(
    profile: Readonly<Record<string, unknown>>
): StalkerAuthReadyOutcome {
    const accountInfo = asRecord(profile['account_info']);
    const accountSummary = compactAccountSummary({
        accountBalance:
            readNonEmptyString(accountInfo?.['account_balance']) ??
            readNonEmptyString(profile['account_balance']),
        expiresAt:
            readNonEmptyString(accountInfo?.['expire_date']) ??
            readNonEmptyString(profile['expire_date']),
        name:
            readNonEmptyString(accountInfo?.['login']) ??
            readNonEmptyString(profile['login']) ??
            readNonEmptyString(profile['name']),
        status:
            readStringLike(accountInfo?.['status']) ??
            readStringLike(profile['status']),
        tariffPlan:
            readNonEmptyString(accountInfo?.['tariff_plan_name']) ??
            readNonEmptyString(profile['tariff_plan_name']),
    });
    const watchdogIntervalSeconds = readPositiveFiniteNumber(
        profile['watchdog_timeout']
    );
    return {
        ...(accountSummary === undefined ? {} : { accountSummary }),
        kind: 'ready',
        ...(watchdogIntervalSeconds === undefined
            ? {}
            : { watchdogIntervalSeconds }),
    };
}

function compactAccountSummary(
    value: StalkerSessionAccountSummary
): StalkerSessionAccountSummary | undefined {
    const compact = Object.fromEntries(
        Object.entries(value).filter(([, field]) => field !== undefined)
    ) as StalkerSessionAccountSummary;
    return Object.keys(compact).length === 0 ? undefined : compact;
}

function readPositiveFiniteNumber(value: unknown): number | undefined {
    const number =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && value.trim() !== ''
              ? Number(value)
              : Number.NaN;
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : undefined;
}

function readStringLike(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return readNonEmptyString(value);
}

function asRecord(
    value: unknown
): Readonly<Record<string, unknown>> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : undefined;
}

function isRetryableFailure(reason: StalkerSessionFailureReason): boolean {
    return (
        reason === STALKER_FAILURE_REASONS.DnsFailure ||
        reason === STALKER_FAILURE_REASONS.NetworkUnreachable ||
        reason === STALKER_FAILURE_REASONS.RequestTimeout ||
        reason === STALKER_FAILURE_REASONS.RateLimited ||
        reason === STALKER_FAILURE_REASONS.PortalUnavailable ||
        reason === STALKER_FAILURE_REASONS.PortalProtectionBlocked
    );
}

function authFailure(
    reason: StalkerSessionFailureReason,
    stage: StalkerSessionStage,
    retryable: boolean,
    retryAfterSeconds?: number
): StalkerAuthFailureOutcome {
    return {
        kind: 'failure',
        reason,
        retryable,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        stage,
    };
}
