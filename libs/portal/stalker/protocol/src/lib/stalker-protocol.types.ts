import type { StalkerSessionApplicationOperation } from '@iptvnator/shared/interfaces';
import {
    STALKER_CONNECTION_STAGES,
    STALKER_FAILURE_REASONS,
    STALKER_PROFILE_RESULT_KINDS,
    STALKER_REQUEST_RECIPES,
} from './stalker-protocol.constants';

export type StalkerRequestRecipe =
    (typeof STALKER_REQUEST_RECIPES)[keyof typeof STALKER_REQUEST_RECIPES];

export type StalkerConnectionStage =
    (typeof STALKER_CONNECTION_STAGES)[keyof typeof STALKER_CONNECTION_STAGES];

export type StalkerFailureReason =
    (typeof STALKER_FAILURE_REASONS)[keyof typeof STALKER_FAILURE_REASONS];

export type StalkerProfileResultKind =
    (typeof STALKER_PROFILE_RESULT_KINDS)[keyof typeof STALKER_PROFILE_RESULT_KINDS];

export type StalkerApplicationOperation =
    StalkerSessionApplicationOperation;

export interface StalkerNormalizedProfileReady {
    kind: typeof STALKER_PROFILE_RESULT_KINDS.Ready;
    profile: Readonly<Record<string, unknown>>;
    status: 0 | 'statusless';
}

export interface StalkerNormalizedProfileBlocked {
    kind: typeof STALKER_PROFILE_RESULT_KINDS.Blocked;
    profile: Readonly<Record<string, unknown>>;
    status: 1;
}

export interface StalkerNormalizedProfileCredentialsRequired {
    kind: typeof STALKER_PROFILE_RESULT_KINDS.CredentialsRequired;
    profile: Readonly<Record<string, unknown>>;
    status: 2;
}

export interface StalkerNormalizedProfileFailure {
    kind: typeof STALKER_PROFILE_RESULT_KINDS.Failure;
    reason: typeof STALKER_FAILURE_REASONS.IncompatibleResponse;
}

export type StalkerNormalizedProfileResult =
    | StalkerNormalizedProfileReady
    | StalkerNormalizedProfileBlocked
    | StalkerNormalizedProfileCredentialsRequired
    | StalkerNormalizedProfileFailure;

export interface StalkerIdentityProfileInput {
    macAddress: string;
    locale?: string;
    language?: string;
    timezone?: string;
    userAgent?: string;
    xUserAgent?: string;
    referer?: string;
    origin?: string;
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
    handshakeRandom?: string;
}

export interface StalkerIdentityPreset {
    id: 'mag250-public-5_1-minimal-v1';
    version: 1;
}

export interface StalkerIdentityProfile {
    preset: StalkerIdentityPreset;
    macAddress: string;
    headers: Readonly<Record<string, string>>;
    managedCookies: Readonly<Record<string, string>>;
    profileParameters: Readonly<Record<string, string | number>>;
    metrics: Readonly<Record<string, string | number>>;
}
