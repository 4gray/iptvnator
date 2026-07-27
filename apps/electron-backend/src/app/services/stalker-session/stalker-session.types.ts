import { STALKER_FAILURE_REASONS } from '@iptvnator/portal/stalker/protocol';
import type {
    StalkerSessionConnectionDescriptor,
    StalkerSessionFailureReason,
} from '@iptvnator/shared/interfaces';

export const STALKER_RUNTIME_LIMITS = {
    maxResponseBytes: 16 * 1024 * 1024,
    playlistRefBytes: 256,
    profileStringBytes: 2048,
    timeoutMs: 120_000,
    transportStringBytes: 4096,
    urlBytes: 4096,
} as const;

export interface StalkerTransportConfig {
    readonly maxResponseBytes: number;
    readonly timeoutMs: number;
}

export const STALKER_TRANSPORT_DEFAULTS = {
    maxResponseBytes: 4 * 1024 * 1024,
    timeoutMs: 15_000,
} as const satisfies StalkerTransportConfig;

export interface StalkerValidatedRuntimeInput {
    readonly descriptor: StalkerSessionConnectionDescriptor;
    readonly transport: StalkerTransportConfig;
}

export interface StalkerTransportResult<T> {
    readonly body: T;
    readonly finalUrl: string;
    readonly status: number;
}

export const STALKER_TRANSPORT_FAILURE_REASONS = {
    DnsFailure: STALKER_FAILURE_REASONS.DnsFailure,
    InvalidIdentityInput: STALKER_FAILURE_REASONS.InvalidIdentityInput,
    InvalidUrl: STALKER_FAILURE_REASONS.InvalidUrl,
    NetworkUnreachable: STALKER_FAILURE_REASONS.NetworkUnreachable,
    RedirectLoop: STALKER_FAILURE_REASONS.RedirectLoop,
    RequestTimeout: STALKER_FAILURE_REASONS.RequestTimeout,
    ResponseTooLarge: STALKER_FAILURE_REASONS.ResponseTooLarge,
    TlsFailure: STALKER_FAILURE_REASONS.TlsFailure,
} as const satisfies Readonly<Record<string, StalkerSessionFailureReason>>;

export type StalkerTransportFailureReason =
    (typeof STALKER_TRANSPORT_FAILURE_REASONS)[keyof typeof STALKER_TRANSPORT_FAILURE_REASONS];

export interface StalkerTransportError {
    readonly reason: StalkerTransportFailureReason;
    readonly retryable: boolean;
}
