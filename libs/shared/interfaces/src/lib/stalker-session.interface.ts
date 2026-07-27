import type {
    StalkerSessionAccountSummary,
    StalkerSessionApplicationOperation,
    StalkerSessionOperationParameters,
    StalkerSessionOperationResult,
} from './stalker-session-operations.interface';

export * from './stalker-session-operations.interface';

export const STALKER_SESSION_CONNECTION_MODES = {
    PersistedOpen: 'persisted-open',
    Provisional: 'provisional',
} as const;

export type StalkerSessionConnectionMode =
    (typeof STALKER_SESSION_CONNECTION_MODES)[keyof typeof STALKER_SESSION_CONNECTION_MODES];

export const STALKER_SESSION_PROVISIONAL_REASONS = {
    Edit: 'edit',
    Import: 'import',
    Migration: 'migration',
} as const;

export type StalkerSessionProvisionalReason =
    (typeof STALKER_SESSION_PROVISIONAL_REASONS)[keyof typeof STALKER_SESSION_PROVISIONAL_REASONS];

export const STALKER_SESSION_REQUEST_RECIPES = {
    FullSession: 'full-session',
    StatelessMac: 'stateless-mac',
} as const;

export type StalkerSessionRequestRecipe =
    (typeof STALKER_SESSION_REQUEST_RECIPES)[keyof typeof STALKER_SESSION_REQUEST_RECIPES];

export const STALKER_SESSION_CONTROL_ACTIONS = {
    Activate: 'activate',
    Deactivate: 'deactivate',
    Commit: 'commit',
    Discard: 'discard',
    Close: 'close',
    ForceRedetect: 'force-redetect',
} as const;

export type StalkerSessionControlAction =
    (typeof STALKER_SESSION_CONTROL_ACTIONS)[keyof typeof STALKER_SESSION_CONTROL_ACTIONS];

export const STALKER_SESSION_FAILURE_REASONS = {
    InvalidUrl: 'invalid-url',
    InvalidIdentityInput: 'invalid-identity-input',
    RedirectLoop: 'redirect-loop',
    EndpointNotFound: 'endpoint-not-found',
    OriginNotApproved: 'origin-not-approved',
    DnsFailure: 'dns-failure',
    NetworkUnreachable: 'network-unreachable',
    RequestTimeout: 'request-timeout',
    TlsFailure: 'tls-failure',
    AccountOrDeviceBlocked: 'account-or-device-blocked',
    DeviceIdentityConflict: 'device-identity-conflict',
    CredentialsAttemptLimit: 'credentials-attempt-limit',
    PrincipalTransitionRequired: 'principal-transition-required',
    AuthRefreshExhausted: 'auth-refresh-exhausted',
    AccountAccessDenied: 'account-access-denied',
    PortalProtectionBlocked: 'portal-protection-blocked',
    RateLimited: 'rate-limited',
    PortalUnavailable: 'portal-unavailable',
    ResponseTooLarge: 'response-too-large',
    IncompatibleResponse: 'incompatible-response',
    LocalPersistenceFailed: 'local-persistence-failed',
    SessionPromotionFailed: 'session-promotion-failed',
} as const;

export type StalkerSessionFailureReason =
    (typeof STALKER_SESSION_FAILURE_REASONS)[keyof typeof STALKER_SESSION_FAILURE_REASONS];

export const STALKER_SESSION_STAGES = {
    New: 'new',
    Resolving: 'resolving',
    AwaitingOriginApproval: 'awaiting-origin-approval',
    Handshaking: 'handshaking',
    ProfileFirst: 'profile-first',
    AwaitingCredentials: 'awaiting-credentials',
    DoAuth: 'do-auth',
    ProfileSecond: 'profile-second',
    Ready: 'ready',
    Refreshing: 'refreshing',
    Persisting: 'persisting',
    Promoting: 'promoting',
} as const;

export type StalkerSessionStage =
    (typeof STALKER_SESSION_STAGES)[keyof typeof STALKER_SESSION_STAGES];

export type StalkerSessionLeaseRef = string;
export type StalkerSessionAttemptRef = string;
export type StalkerSessionChallengeRef = string;

export interface StalkerSessionProfilePreset {
    id: 'mag250-public-5_1-minimal-v1';
    version: 1;
}

export interface StalkerSessionIdentityOverrides {
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
    prehash?: string;
    apiSignature?: string;
    firmwareVersion?: string;
    imageVersion?: string;
    hardwareVersion?: string;
    hardwareVersion2?: string;
    numberOfBanks?: string;
    videoOutput?: string;
}

export interface StalkerSessionTransportConfiguration {
    userAgent?: string;
    xUserAgent?: string;
    referer?: string;
    origin?: string;
    refererPolicy?: string;
    originPolicy?: string;
    locale?: string;
    language?: string;
    timezone?: string;
}

export interface StalkerSessionConnectionDescriptorBase {
    playlistRef: string;
    sourceUrl: string;
    learnedEndpointHint?: string;
    macAddress: string;
    profilePreset: StalkerSessionProfilePreset;
    identityOverrides?: StalkerSessionIdentityOverrides;
    transportConfiguration?: StalkerSessionTransportConfiguration;
}

export interface StalkerSessionPersistedConnectionDescriptor
    extends StalkerSessionConnectionDescriptorBase {
    connectionMode: 'persisted-open';
    provisionalReason?: never;
}

export interface StalkerSessionProvisionalConnectionDescriptor
    extends StalkerSessionConnectionDescriptorBase {
    connectionMode: 'provisional';
    provisionalReason: StalkerSessionProvisionalReason;
}

export type StalkerSessionConnectionDescriptor =
    | StalkerSessionPersistedConnectionDescriptor
    | StalkerSessionProvisionalConnectionDescriptor;

export interface StalkerSessionOpenRequest {
    descriptor: StalkerSessionConnectionDescriptor;
}

export interface StalkerSessionOriginApprovalResponse {
    kind: 'origin-approval';
    approved: boolean;
}

export interface StalkerSessionCredentialsResponse {
    kind: 'credentials';
    username: string;
    password: string;
}

export type StalkerSessionChallengeResponse =
    | StalkerSessionOriginApprovalResponse
    | StalkerSessionCredentialsResponse;

export interface StalkerSessionContinueRequest {
    challengeRef: StalkerSessionChallengeRef;
    response: StalkerSessionChallengeResponse;
}

export interface StalkerSessionCapabilities {
    authenticatedSession: boolean;
    playbackContext: boolean;
}

export interface StalkerSessionPersistenceDraft {
    stalkerSourceUrl?: string;
    portalUrl: string;
    stalkerLandingUrl: string;
    stalkerRequestRecipe: StalkerSessionRequestRecipe;
    stalkerRecipeClassifierVersion: number;
    stalkerLastVerifiedAt?: string;
    isFullStalkerPortal: boolean;
}

export interface StalkerSessionPersistedReadyState {
    connectionMode: 'persisted-open';
    provisionalReason?: never;
    attemptRef?: never;
}

export interface StalkerSessionProvisionalReadyState {
    connectionMode: 'provisional';
    provisionalReason: StalkerSessionProvisionalReason;
    attemptRef: StalkerSessionAttemptRef;
}

export interface StalkerSessionFullReadyOutcomeBase {
    kind: 'ready';
    recipe: 'full-session';
    requestId: string;
    endpoint: string;
    landingUrl: string;
    leaseRef: StalkerSessionLeaseRef;
    capabilities: StalkerSessionCapabilities;
    accountSummary?: StalkerSessionAccountSummary;
    persistenceDraft: StalkerSessionPersistenceDraft;
}

export type StalkerSessionFullReadyOutcome =
    StalkerSessionFullReadyOutcomeBase &
        (StalkerSessionPersistedReadyState | StalkerSessionProvisionalReadyState);

export interface StalkerSessionStatelessReadyOutcomeBase {
    kind: 'ready';
    recipe: 'stateless-mac';
    requestId: string;
    endpoint: string;
    landingUrl: string;
    persistenceDraft: StalkerSessionPersistenceDraft;
}

export type StalkerSessionStatelessReadyOutcome =
    StalkerSessionStatelessReadyOutcomeBase &
        (StalkerSessionPersistedReadyState | StalkerSessionProvisionalReadyState);

export interface StalkerSessionOriginApprovalRequiredOutcome {
    kind: 'origin-approval-required';
    requestId: string;
    challengeRef: StalkerSessionChallengeRef;
    sourceOrigin: string;
    finalOrigin: string;
}

export interface StalkerSessionCredentialsRequiredOutcome {
    kind: 'credentials-required';
    requestId: string;
    challengeRef: StalkerSessionChallengeRef;
    attemptNumber: number;
    savedCredentialsRejected?: boolean;
}

export interface StalkerSessionFailureOutcome {
    kind: 'failure';
    requestId: string;
    reason: StalkerSessionFailureReason;
    stage: StalkerSessionStage;
    retryable: boolean;
    retryAfterSeconds?: number;
}

export type StalkerSessionConnectionOutcome =
    | StalkerSessionFullReadyOutcome
    | StalkerSessionStatelessReadyOutcome
    | StalkerSessionOriginApprovalRequiredOutcome
    | StalkerSessionCredentialsRequiredOutcome
    | StalkerSessionFailureOutcome;

export type StalkerSessionRequest<
    Operation extends
        StalkerSessionApplicationOperation = StalkerSessionApplicationOperation,
> = {
    [CurrentOperation in Operation]: {
        leaseRef: StalkerSessionLeaseRef;
        operation: CurrentOperation;
        parameters: StalkerSessionOperationParameters<CurrentOperation>;
    };
}[Operation];

export type StalkerSessionRequestSuccess<
    Operation extends
        StalkerSessionApplicationOperation = StalkerSessionApplicationOperation,
> = {
    [CurrentOperation in Operation]: {
        kind: 'success';
        requestId: string;
        operation: CurrentOperation;
        payload: StalkerSessionOperationResult<CurrentOperation>;
    };
}[Operation];

export type StalkerSessionRequestOutcome<
    Operation extends
        StalkerSessionApplicationOperation = StalkerSessionApplicationOperation,
> =
    | StalkerSessionRequestSuccess<Operation>
    | StalkerSessionOriginApprovalRequiredOutcome
    | StalkerSessionCredentialsRequiredOutcome
    | StalkerSessionFailureOutcome;

export interface StalkerSessionLeaseControlRequest {
    action: 'activate' | 'deactivate' | 'close' | 'force-redetect';
    leaseRef: StalkerSessionLeaseRef;
}

export interface StalkerSessionAttemptControlRequest {
    action: 'commit' | 'discard';
    attemptRef: StalkerSessionAttemptRef;
}

export type StalkerSessionControlRequest =
    | StalkerSessionLeaseControlRequest
    | StalkerSessionAttemptControlRequest;

export interface StalkerSessionControlSuccess {
    kind: 'success';
    requestId: string;
    action: StalkerSessionControlAction;
}

export type StalkerSessionControlOutcome =
    | StalkerSessionControlSuccess
    | StalkerSessionConnectionOutcome;
