export const REPLAY_SCHEMA_VERSION = 1 as const;

export const REPLAY_MAX_FIXTURE_BYTES = 1024 * 1024;
export const REPLAY_MAX_PHASES = 128;
export const REPLAY_MAX_EXPECTATIONS = 512;
export const REPLAY_MAX_REQUESTS = 512;
export const REPLAY_MAX_GENERATED_BODY_BYTES = 16 * 1024 * 1024;
export const REPLAY_RUN_HARD_LIFETIME_MS = 10 * 60 * 1000;
export const REPLAY_RUN_INACTIVITY_MS = 2 * 60 * 1000;

export const REPLAY_SYMBOL_VALUE_KINDS = [
    'mac',
    'credential',
    'token',
    'random',
    'cookie',
    'correlation',
] as const;

export const REPLAY_HTTP_METHODS = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS',
] as const;

export const REPLAY_COOKIE_ATTRIBUTE_NAMES = [
    'domain',
    'path',
    'secure',
    'httpOnly',
    'sameSite',
    'maxAge',
    'expires',
] as const;
