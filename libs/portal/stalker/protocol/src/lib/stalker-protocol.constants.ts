export const STALKER_RECIPE_CLASSIFIER_VERSION = 1;
export const STALKER_ENDPOINT_CANDIDATE_LIMIT = 6;

export const STALKER_REQUEST_RECIPES = {
    FullSession: 'full-session',
    StatelessMac: 'stateless-mac',
} as const;

export const STALKER_CONNECTION_STAGES = {
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
    Rejected: 'rejected',
    Failure: 'failure',
    Persisting: 'persisting',
    Promoting: 'promoting',
} as const;

export const STALKER_FAILURE_REASONS = {
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

export const STALKER_PROFILE_RESULT_KINDS = {
    Ready: 'ready',
    Blocked: 'blocked',
    CredentialsRequired: 'credentials-required',
    Failure: 'failure',
} as const;

export const STALKER_RESERVED_REQUEST_PARAMETERS = [
    'action',
    'api_signature',
    'auth_second_step',
    'client_type',
    'device_id',
    'device_id2',
    'hd',
    'hw_version',
    'hw_version_2',
    'image_version',
    'jshttprequest',
    'language',
    'login',
    'mac',
    'metrics',
    'not_valid_token',
    'num_banks',
    'password',
    'prehash',
    'random',
    'serial',
    'signature',
    'signature2',
    'sn',
    'stb_lang',
    'stb_type',
    'timestamp',
    'timezone',
    'token',
    'ver',
    'video_out',
] as const;

export const STALKER_MANAGED_REQUEST_HEADERS = [
    'accept-language',
    'authorization',
    'cookie',
    'origin',
    'referer',
    'sn',
    'user-agent',
    'x-user-agent',
] as const;

export const STALKER_JSONP_CALLBACKS = [
    'callback',
    'stalkerCallback',
] as const;
