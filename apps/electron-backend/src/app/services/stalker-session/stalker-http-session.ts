import type { RawAxiosRequestHeaders, RawAxiosResponseHeaders } from 'axios';
import {
    STALKER_FAILURE_REASONS,
    normalizeStalkerSourceUrl,
} from '@iptvnator/portal/stalker/protocol';
import type { StalkerSessionFailureReason } from '@iptvnator/shared/interfaces';
import { requestWithValidatedRedirects } from '../../util/validated-axios';
import type { ValidatedAxiosRedirectContext } from '../../util/validated-axios';
import { StalkerCookieJar } from './stalker-cookie-jar';
import { StalkerRuntimeValidationError } from './stalker-runtime-validation';
import {
    STALKER_RUNTIME_LIMITS,
    type StalkerTransportConfig,
    type StalkerTransportResult,
} from './stalker-session.types';
import { mapStalkerTransportError } from './stalker-transport-errors';

export const STALKER_HTTP_REQUEST_MODES = {
    Anonymous: 'anonymous',
    IdentityBearing: 'identity-bearing',
} as const;

export type StalkerHttpRequestMode =
    (typeof STALKER_HTTP_REQUEST_MODES)[keyof typeof STALKER_HTTP_REQUEST_MODES];

export const STALKER_HTTP_OUTCOME_KINDS = {
    Failure: 'failure',
    OriginApprovalRequired: 'origin-approval-required',
    Success: 'success',
} as const;

export type StalkerHttpParameterValue = string | number;
export type StalkerHttpParameters = Readonly<
    Record<string, StalkerHttpParameterValue>
>;

export interface StalkerAnonymousHttpRequest {
    readonly mode: typeof STALKER_HTTP_REQUEST_MODES.Anonymous;
    readonly params?: StalkerHttpParameters;
    readonly url: string;
}

export interface StalkerIdentityBearingHttpRequest {
    readonly headers: Readonly<Record<string, string>>;
    readonly mode: typeof STALKER_HTTP_REQUEST_MODES.IdentityBearing;
    readonly params?: StalkerHttpParameters;
    readonly url: string;
}

export type StalkerHttpRequest =
    | StalkerAnonymousHttpRequest
    | StalkerIdentityBearingHttpRequest;

export interface StalkerHttpSuccessOutcome {
    readonly kind: typeof STALKER_HTTP_OUTCOME_KINDS.Success;
    readonly result: StalkerTransportResult<Uint8Array>;
}

export interface StalkerHttpOriginApprovalRequiredOutcome {
    readonly finalOrigin: string;
    readonly kind: typeof STALKER_HTTP_OUTCOME_KINDS.OriginApprovalRequired;
    readonly sourceOrigin: string;
    readonly targetUrl: string;
}

export interface StalkerHttpFailureOutcome {
    readonly kind: typeof STALKER_HTTP_OUTCOME_KINDS.Failure;
    readonly reason: StalkerSessionFailureReason;
    readonly retryable: boolean;
}

export type StalkerHttpRequestOutcome =
    | StalkerHttpSuccessOutcome
    | StalkerHttpOriginApprovalRequiredOutcome
    | StalkerHttpFailureOutcome;

const CALLER_MANAGED_HEADERS = new Set(['cookie', 'proxy-authorization']);

class StalkerOriginApprovalPause extends Error {
    constructor(
        readonly sourceOrigin: string,
        readonly finalOrigin: string,
        readonly targetUrl: string
    ) {
        super(STALKER_HTTP_OUTCOME_KINDS.OriginApprovalRequired);
        this.name = 'StalkerOriginApprovalPause';
    }
}

export class StalkerHttpSession {
    constructor(
        private readonly cookieJar: StalkerCookieJar,
        private readonly transport: StalkerTransportConfig
    ) {}

    async request(
        request: StalkerHttpRequest
    ): Promise<StalkerHttpRequestOutcome> {
        try {
            assertTransportConfig(this.transport);
            const sourceUrl = normalizeStalkerSourceUrl(request.url);
            const sourceOrigin = new URL(sourceUrl).origin;
            const identityBearing =
                request.mode === STALKER_HTTP_REQUEST_MODES.IdentityBearing;
            const baseHeaders = identityBearing
                ? copyIdentityHeaders(request.headers)
                : undefined;
            let finalUrl = sourceUrl;

            const response = await requestWithValidatedRedirects<unknown>(
                sourceUrl,
                {
                    headers: baseHeaders,
                    maxBodyLength: this.transport.maxResponseBytes,
                    maxContentLength: this.transport.maxResponseBytes,
                    method: 'GET',
                    params:
                        request.params === undefined
                            ? undefined
                            : { ...request.params },
                    paramsSerializer: hasOwnCommandParameter(request.params)
                        ? {
                              serialize: serializeStalkerHttpParameters,
                          }
                        : undefined,
                    redirectHooks: {
                        beforeValidatedRedirect: (redirect) => {
                            validateRedirectTarget(
                                redirect,
                                identityBearing,
                                sourceOrigin
                            );
                        },
                        collectResponse: async (hop) => {
                            finalUrl = normalizeStalkerSourceUrl(hop.url);
                            await this.cookieJar.collectResponseCookies(
                                hop.url,
                                readSetCookieHeaders(hop.headers)
                            );
                        },
                        prepareHeaders: async (hop) => {
                            const cookieHeader =
                                await this.cookieJar.getCookieHeader(hop.url);
                            return prepareHopHeaders(hop.headers, cookieHeader);
                        },
                    },
                    responseType: 'arraybuffer',
                    timeout: this.transport.timeoutMs,
                    validateStatus: () => true,
                },
                {
                    allowPrivateNetworkRedirects: identityBearing,
                    allowPrivateNetworks: true,
                    pinAllowedPrivateNetworkHosts: true,
                }
            );

            const byteLength = responseByteLength(response.data);
            if (byteLength === undefined) {
                return failure(
                    STALKER_FAILURE_REASONS.IncompatibleResponse,
                    false
                );
            }
            if (byteLength > this.transport.maxResponseBytes) {
                return failure(STALKER_FAILURE_REASONS.ResponseTooLarge, false);
            }
            if (!isHttpStatus(response.status)) {
                return failure(
                    STALKER_FAILURE_REASONS.IncompatibleResponse,
                    false
                );
            }

            return {
                kind: STALKER_HTTP_OUTCOME_KINDS.Success,
                result: {
                    body: copyResponseBytes(response.data),
                    ...readResponseMetadata(response.headers),
                    finalUrl,
                    status: response.status,
                },
            };
        } catch (error) {
            if (error instanceof StalkerOriginApprovalPause) {
                return {
                    finalOrigin: error.finalOrigin,
                    kind: STALKER_HTTP_OUTCOME_KINDS.OriginApprovalRequired,
                    sourceOrigin: error.sourceOrigin,
                    targetUrl: error.targetUrl,
                };
            }

            const mapped = mapStalkerTransportError(error);
            return mapped
                ? failure(mapped.reason, mapped.retryable)
                : failure(STALKER_FAILURE_REASONS.IncompatibleResponse, false);
        }
    }
}

function serializeStalkerHttpParameters(
    parameters: StalkerHttpParameters
): string {
    return Object.entries(parameters)
        .map(([key, value]) => {
            const encodedValue = encodeURIComponent(String(value));
            const compatibleValue =
                key === 'cmd'
                    ? encodedValue.replace(/%2F/gi, '/')
                    : encodedValue;
            return `${encodeURIComponent(key)}=${compatibleValue}`;
        })
        .join('&');
}

function hasOwnCommandParameter(
    parameters: StalkerHttpParameters | undefined
): boolean {
    return (
        parameters !== undefined &&
        Object.prototype.hasOwnProperty.call(parameters, 'cmd')
    );
}

function assertTransportConfig(config: StalkerTransportConfig): void {
    if (
        !isPositiveFiniteBound(
            config.timeoutMs,
            STALKER_RUNTIME_LIMITS.timeoutMs
        ) ||
        !isPositiveFiniteBound(
            config.maxResponseBytes,
            STALKER_RUNTIME_LIMITS.maxResponseBytes
        )
    ) {
        throw new StalkerRuntimeValidationError(
            STALKER_FAILURE_REASONS.InvalidIdentityInput
        );
    }
}

function isPositiveFiniteBound(value: number, maximum: number): boolean {
    return Number.isFinite(value) && value > 0 && value <= maximum;
}

function copyIdentityHeaders(
    headers: Readonly<Record<string, string>>
): RawAxiosRequestHeaders {
    return Object.fromEntries(
        Object.entries(headers).filter(
            ([name]) => !CALLER_MANAGED_HEADERS.has(name.toLowerCase())
        )
    );
}

function prepareHopHeaders(
    headers: RawAxiosRequestHeaders,
    cookieHeader: string | undefined
): RawAxiosRequestHeaders {
    const prepared = Object.fromEntries(
        Object.entries(headers).filter(
            ([name]) => !CALLER_MANAGED_HEADERS.has(name.toLowerCase())
        )
    ) as RawAxiosRequestHeaders;
    if (cookieHeader !== undefined) {
        prepared['Cookie'] = cookieHeader;
    }
    return prepared;
}

function readSetCookieHeaders(
    headers: RawAxiosResponseHeaders
): string | readonly string[] | undefined {
    const value = headers['set-cookie'];
    if (typeof value === 'string') {
        return value;
    }
    if (
        Array.isArray(value) &&
        value.every((entry): entry is string => typeof entry === 'string')
    ) {
        return value;
    }
    return undefined;
}

function readResponseMetadata(
    headers: RawAxiosResponseHeaders
): Pick<StalkerTransportResult<unknown>, 'contentType' | 'retryAfterSeconds'> {
    const contentType = readStringHeader(headers, 'content-type');
    const retryAfter = readStringHeader(headers, 'retry-after');
    const retryAfterSeconds =
        retryAfter === undefined ? undefined : Number(retryAfter.trim());
    return {
        ...(contentType === undefined ? {} : { contentType }),
        ...(retryAfterSeconds !== undefined &&
        Number.isFinite(retryAfterSeconds) &&
        retryAfterSeconds >= 0
            ? { retryAfterSeconds }
            : {}),
    };
}

function readStringHeader(
    headers: RawAxiosResponseHeaders,
    name: string
): string | undefined {
    const value = headers[name];
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return undefined;
}

function validateRedirectTarget(
    redirect: ValidatedAxiosRedirectContext,
    identityBearing: boolean,
    sourceOrigin: string
): void {
    const normalizedTarget = normalizeStalkerSourceUrl(redirect.toUrl);
    if (identityBearing && redirect.crossOrigin) {
        throw new StalkerOriginApprovalPause(
            sourceOrigin,
            new URL(normalizedTarget).origin,
            normalizedTarget
        );
    }
}

function responseByteLength(value: unknown): number | undefined {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return value.byteLength;
    }
    return undefined;
}

function copyResponseBytes(value: unknown): Uint8Array {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value.slice(0));
    }
    if (ArrayBuffer.isView(value)) {
        return Uint8Array.from(
            new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        );
    }
    throw new Error(STALKER_FAILURE_REASONS.IncompatibleResponse);
}

function isHttpStatus(status: number): boolean {
    return Number.isInteger(status) && status >= 100 && status <= 599;
}

function failure(
    reason: StalkerSessionFailureReason,
    retryable: boolean
): StalkerHttpFailureOutcome {
    return {
        kind: STALKER_HTTP_OUTCOME_KINDS.Failure,
        reason,
        retryable,
    };
}
