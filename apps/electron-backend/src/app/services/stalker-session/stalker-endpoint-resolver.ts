import {
    STALKER_ENDPOINT_CANDIDATE_LIMIT,
    STALKER_FAILURE_REASONS,
    classifyStalkerProfile,
    classifyStalkerResponseFailure,
    createStalkerIdentityProfile,
    deduplicateAndLimitStalkerEndpointCandidates,
    deriveStalkerEndpointCandidates,
    normalizeStalkerSourceUrl,
    parseStalkerResponseEnvelope,
    type StalkerIdentityProfile,
    type StalkerNormalizedProfileResult,
} from '@iptvnator/portal/stalker/protocol';
import type {
    StalkerSessionConnectionDescriptor,
    StalkerSessionFailureReason,
    StalkerSessionStage,
} from '@iptvnator/shared/interfaces';
import { StalkerCookieJar } from './stalker-cookie-jar';
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

const EXPLICITLY_UNSUPPORTED_STATUSES = new Set([404, 405, 501]);
const TOKEN_BYTES_LIMIT = 4096;

interface StalkerHttpSessionLike {
    request(request: StalkerHttpRequest): Promise<StalkerHttpRequestOutcome>;
}

export interface StalkerEndpointResolverDependencies {
    createCookieJar?: () => StalkerCookieJar;
    createHttpSession?: (
        jar: StalkerCookieJar,
        transport: StalkerTransportConfig
    ) => StalkerHttpSessionLike;
}

export interface StalkerEndpointResolverInput {
    approvedOrigins?: readonly string[];
    descriptor: StalkerSessionConnectionDescriptor;
    transport: StalkerTransportConfig;
}

export interface StalkerEndpointFullSessionOutcome {
    cookieJar: StalkerCookieJar;
    endpoint: string;
    handshakeRandom?: string;
    identity: StalkerIdentityProfile;
    kind: 'full-session';
    landingUrl: string;
    profile: Exclude<StalkerNormalizedProfileResult, { kind: 'failure' }>;
    profileEnvelope: unknown;
    token: string;
}

export interface StalkerEndpointStatelessOutcome {
    endpoint: string;
    kind: 'stateless-mac';
    landingUrl: string;
}

export interface StalkerEndpointOriginApprovalOutcome {
    finalOrigin: string;
    kind: 'origin-approval-required';
    landingUrl: string;
    sourceOrigin: string;
}

export interface StalkerEndpointFailureOutcome {
    kind: 'failure';
    reason: StalkerSessionFailureReason;
    retryable: boolean;
    retryAfterSeconds?: number;
    stage: StalkerSessionStage;
}

export type StalkerEndpointResolverOutcome =
    | StalkerEndpointFullSessionOutcome
    | StalkerEndpointStatelessOutcome
    | StalkerEndpointOriginApprovalOutcome
    | StalkerEndpointFailureOutcome;

interface ParsedTransportEnvelope {
    rawBody: string;
    result: StalkerTransportResult<Uint8Array>;
    value?: unknown;
}

interface CandidateProbeUnsupported {
    kind: 'unsupported';
}

interface CandidateProbeMiss {
    kind: 'miss';
}

type CandidateProbeOutcome =
    | StalkerEndpointFullSessionOutcome
    | StalkerEndpointOriginApprovalOutcome
    | StalkerEndpointFailureOutcome
    | CandidateProbeUnsupported
    | CandidateProbeMiss;

export class StalkerEndpointResolver {
    private readonly createCookieJar: () => StalkerCookieJar;
    private readonly createHttpSession: (
        jar: StalkerCookieJar,
        transport: StalkerTransportConfig
    ) => StalkerHttpSessionLike;

    constructor(dependencies: StalkerEndpointResolverDependencies = {}) {
        this.createCookieJar =
            dependencies.createCookieJar ?? (() => new StalkerCookieJar());
        this.createHttpSession =
            dependencies.createHttpSession ??
            ((jar, transport) => new StalkerHttpSession(jar, transport));
    }

    async resolve(
        input: StalkerEndpointResolverInput
    ): Promise<StalkerEndpointResolverOutcome> {
        const sourceUrl = normalizeStalkerSourceUrl(input.descriptor.sourceUrl);
        const sourceOrigin = new URL(sourceUrl).origin;
        const anonymousJar = this.createCookieJar();
        const landingSession = this.createHttpSession(
            anonymousJar,
            input.transport
        );
        const landingOutcome = await landingSession.request({
            mode: STALKER_HTTP_REQUEST_MODES.Anonymous,
            url: sourceUrl,
        });
        if (landingOutcome.kind === STALKER_HTTP_OUTCOME_KINDS.Failure) {
            return failure(landingOutcome.reason, landingOutcome.retryable);
        }
        if (
            landingOutcome.kind ===
            STALKER_HTTP_OUTCOME_KINDS.OriginApprovalRequired
        ) {
            return {
                finalOrigin: landingOutcome.finalOrigin,
                kind: landingOutcome.kind,
                landingUrl: landingOutcome.targetUrl,
                sourceOrigin: landingOutcome.sourceOrigin,
            };
        }

        const landingInspection = inspectResponseFailure(landingOutcome.result);
        if (landingInspection !== null) {
            return landingInspection;
        }

        const landingUrl = normalizeStalkerSourceUrl(
            landingOutcome.result.finalUrl
        );
        const finalOrigin = new URL(landingUrl).origin;
        const approvedOrigins = normalizeApprovedOrigins(input.approvedOrigins);
        if (finalOrigin !== sourceOrigin && !approvedOrigins.has(finalOrigin)) {
            return {
                finalOrigin,
                kind: 'origin-approval-required',
                landingUrl,
                sourceOrigin,
            };
        }

        const identity = buildIdentity(input.descriptor, landingUrl);
        const candidates = buildCandidates(
            landingUrl,
            input.descriptor.learnedEndpointHint
        );
        let statelessFallback: string | undefined;

        for (const endpoint of candidates) {
            const candidateJar = await anonymousJar.cloneWithManagedCookies(
                identity.managedCookies
            );
            const candidateSession = this.createHttpSession(
                candidateJar,
                input.transport
            );
            const probe = await this.probeCandidate({
                candidateJar,
                candidateSession,
                endpoint,
                identity,
                landingUrl,
                transport: input.transport,
            });

            if (
                probe.kind === 'full-session' ||
                probe.kind === 'failure' ||
                probe.kind === 'origin-approval-required'
            ) {
                return probe;
            }
            if (probe.kind === 'unsupported') {
                const simple = await this.probeStateless(
                    candidateSession,
                    endpoint,
                    identity
                );
                if (
                    simple.kind === 'failure' ||
                    simple.kind === 'origin-approval-required'
                ) {
                    return simple;
                }
                if (simple.kind === 'stateless-mac') {
                    statelessFallback ??= endpoint;
                }
            }
        }

        return statelessFallback === undefined
            ? failure(STALKER_FAILURE_REASONS.EndpointNotFound, false)
            : {
                  endpoint: statelessFallback,
                  kind: 'stateless-mac',
                  landingUrl,
              };
    }

    private async probeCandidate(input: {
        candidateJar: StalkerCookieJar;
        candidateSession: StalkerHttpSessionLike;
        endpoint: string;
        identity: StalkerIdentityProfile;
        landingUrl: string;
        transport: StalkerTransportConfig;
    }): Promise<CandidateProbeOutcome> {
        const handshake = await input.candidateSession.request({
            headers: input.identity.headers,
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: {
                action: 'handshake',
                JsHttpRequest: '1-xml',
                type: 'stb',
            },
            url: input.endpoint,
        });
        const normalizedHandshake = normalizeProtocolOutcome(handshake);
        if (normalizedHandshake.kind !== 'parsed') {
            return normalizedHandshake;
        }

        const handshakeEnvelope = asRecord(normalizedHandshake.value);
        const handshakeValue = asRecord(handshakeEnvelope?.['js']);
        const token = boundedNonEmptyString(handshakeValue?.['token']);
        if (token === undefined) {
            return { kind: 'miss' };
        }
        const handshakeRandom = boundedOptionalString(
            handshakeValue?.['random']
        );
        const profileIdentity = withHandshakeRandom(
            input.identity,
            handshakeRandom
        );
        const profile = await input.candidateSession.request({
            headers: {
                ...profileIdentity.headers,
                Authorization: `Bearer ${token}`,
            },
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: {
                ...profileIdentity.profileParameters,
                action: 'get_profile',
                auth_second_step: 0,
                JsHttpRequest: '1-xml',
                metrics: JSON.stringify(profileIdentity.metrics),
                not_valid_token: 0,
                type: 'stb',
            },
            url: input.endpoint,
        });
        const normalizedProfile = normalizeProtocolOutcome(profile);
        if (normalizedProfile.kind !== 'parsed') {
            return normalizedProfile;
        }

        const classifiedProfile = classifyStalkerProfile(
            normalizedProfile.value
        );
        if (classifiedProfile.kind === 'failure') {
            return { kind: 'miss' };
        }

        return {
            cookieJar: input.candidateJar,
            endpoint: input.endpoint,
            ...(handshakeRandom === undefined ? {} : { handshakeRandom }),
            identity: profileIdentity,
            kind: 'full-session',
            landingUrl: input.landingUrl,
            profile: classifiedProfile,
            profileEnvelope: normalizedProfile.value,
            token,
        };
    }

    private async probeStateless(
        session: StalkerHttpSessionLike,
        endpoint: string,
        identity: StalkerIdentityProfile
    ): Promise<
        | StalkerEndpointStatelessOutcome
        | StalkerEndpointOriginApprovalOutcome
        | StalkerEndpointFailureOutcome
        | CandidateProbeMiss
    > {
        const outcome = await session.request({
            headers: identity.headers,
            mode: STALKER_HTTP_REQUEST_MODES.IdentityBearing,
            params: {
                action: 'get_genres',
                JsHttpRequest: '1-xml',
                type: 'itv',
            },
            url: endpoint,
        });
        const normalized = normalizeProtocolOutcome(outcome);
        if (normalized.kind !== 'parsed') {
            return normalized.kind === 'unsupported'
                ? { kind: 'miss' }
                : normalized;
        }
        const envelope = asRecord(normalized.value);
        return Array.isArray(envelope?.['js'])
            ? {
                  endpoint,
                  kind: 'stateless-mac',
                  landingUrl: endpoint,
              }
            : { kind: 'miss' };
    }
}

function buildIdentity(
    descriptor: StalkerSessionConnectionDescriptor,
    landingUrl: string
): StalkerIdentityProfile {
    return createStalkerIdentityProfile({
        macAddress: descriptor.macAddress,
        ...descriptor.identityOverrides,
        ...descriptor.transportConfiguration,
        referer: descriptor.transportConfiguration?.referer ?? landingUrl,
    });
}

function withHandshakeRandom(
    identity: StalkerIdentityProfile,
    handshakeRandom: string | undefined
): StalkerIdentityProfile {
    if (handshakeRandom === undefined) {
        return identity;
    }
    return {
        ...identity,
        metrics: {
            ...identity.metrics,
            random: handshakeRandom,
        },
    };
}

function buildCandidates(
    landingUrl: string,
    learnedEndpointHint: string | undefined
): readonly string[] {
    const candidates = [
        ...(learnedEndpointHint === undefined
            ? []
            : [normalizeStalkerSourceUrl(learnedEndpointHint)]),
        ...deriveStalkerEndpointCandidates(landingUrl),
    ];
    return deduplicateAndLimitStalkerEndpointCandidates(candidates).slice(
        0,
        STALKER_ENDPOINT_CANDIDATE_LIMIT
    );
}

function normalizeApprovedOrigins(
    origins: readonly string[] | undefined
): ReadonlySet<string> {
    const normalized = new Set<string>();
    for (const origin of origins ?? []) {
        try {
            const parsed = new URL(origin);
            if (
                (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
                parsed.origin === origin
            ) {
                normalized.add(parsed.origin);
            }
        } catch {
            // Runtime input validation rejects malformed values at the IPC
            // boundary. Ignoring one here remains fail-closed.
        }
    }
    return normalized;
}

function normalizeProtocolOutcome(
    outcome: StalkerHttpRequestOutcome
):
    | { kind: 'parsed'; value: unknown }
    | CandidateProbeUnsupported
    | CandidateProbeMiss
    | StalkerEndpointOriginApprovalOutcome
    | StalkerEndpointFailureOutcome {
    if (outcome.kind === STALKER_HTTP_OUTCOME_KINDS.Failure) {
        return failure(outcome.reason, outcome.retryable);
    }
    if (outcome.kind === STALKER_HTTP_OUTCOME_KINDS.OriginApprovalRequired) {
        return {
            finalOrigin: outcome.finalOrigin,
            kind: outcome.kind,
            landingUrl: outcome.targetUrl,
            sourceOrigin: outcome.sourceOrigin,
        };
    }

    const parsed = parseTransportEnvelope(outcome.result);
    const classifiedFailure = classifyStalkerResponseFailure({
        httpStatus: outcome.result.status,
        rawBody: parsed?.rawBody,
        value: parsed?.value,
    });
    if (classifiedFailure.kind === 'failure') {
        return failure(
            classifiedFailure.reason,
            classifiedFailure.reason !==
                STALKER_FAILURE_REASONS.IncompatibleResponse,
            outcome.result.retryAfterSeconds
        );
    }
    if (classifiedFailure.kind === 'token-rejected') {
        return failure(STALKER_FAILURE_REASONS.IncompatibleResponse, false);
    }
    if (EXPLICITLY_UNSUPPORTED_STATUSES.has(outcome.result.status)) {
        return { kind: 'unsupported' };
    }
    if (outcome.result.status !== 200 || parsed === null) {
        return { kind: 'miss' };
    }
    return { kind: 'parsed', value: parsed.value };
}

function inspectResponseFailure(
    result: StalkerTransportResult<Uint8Array>
): StalkerEndpointFailureOutcome | null {
    const parsed = parseTransportEnvelope(result);
    const classified = classifyStalkerResponseFailure({
        httpStatus: result.status,
        rawBody: parsed?.rawBody,
        value: parsed?.value,
    });
    if (classified.kind === 'failure') {
        return failure(
            classified.reason,
            classified.reason !== STALKER_FAILURE_REASONS.IncompatibleResponse,
            result.retryAfterSeconds
        );
    }
    if (classified.kind === 'token-rejected') {
        return failure(STALKER_FAILURE_REASONS.IncompatibleResponse, false);
    }
    return null;
}

function parseTransportEnvelope(
    result: StalkerTransportResult<Uint8Array>
): ParsedTransportEnvelope | null {
    let rawBody: string;
    try {
        rawBody = new TextDecoder('utf-8', { fatal: true }).decode(result.body);
    } catch {
        return null;
    }
    const parsed = parseStalkerResponseEnvelope({
        body: rawBody,
        contentType: result.contentType,
        maxBodyBytes: result.body.byteLength,
    });
    return parsed.kind === 'parsed'
        ? { rawBody, result, value: parsed.value }
        : { rawBody, result };
}

function boundedNonEmptyString(value: unknown): string | undefined {
    if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        Buffer.byteLength(value, 'utf8') > TOKEN_BYTES_LIMIT
    ) {
        return undefined;
    }
    return value;
}

function boundedOptionalString(value: unknown): string | undefined {
    return value === undefined ? undefined : boundedNonEmptyString(value);
}

function asRecord(
    value: unknown
): Readonly<Record<string, unknown>> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : undefined;
}

function failure(
    reason: StalkerSessionFailureReason,
    retryable: boolean,
    retryAfterSeconds?: number
): StalkerEndpointFailureOutcome {
    return {
        kind: 'failure',
        reason,
        retryable,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        stage: 'resolving',
    };
}
