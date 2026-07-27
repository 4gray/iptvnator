import { normalizeStalkerPortalIdentity } from '@iptvnator/portal/stalker/data-access';
import type {
    Playlist,
    StalkerSessionAccountSummary,
    StalkerSessionConnectionOutcome,
    StalkerSessionFullReadyOutcome,
    StalkerSessionIdentityOverrides,
    StalkerSessionStatelessReadyOutcome,
} from '@iptvnator/shared/interfaces';

export interface StalkerImportFormValue {
    _id: string | null;
    title: string | null;
    macAddress: string | null;
    serialNumber: string | null;
    deviceId1: string | null;
    deviceId2: string | null;
    signature1: string | null;
    signature2: string | null;
    password: string | null;
    username: string | null;
    portalUrl: string | null;
    importDate: string | null;
    userAgent: string | null;
}

export interface StalkerAcceptedCredentials {
    readonly username: string;
    readonly password: string;
}

export type StalkerImportReadyOutcome =
    | StalkerSessionFullReadyOutcome
    | StalkerSessionStatelessReadyOutcome;

const DEFAULT_PROFILE_PRESET = {
    id: 'mag250-public-5_1-minimal-v1' as const,
    version: 1 as const,
};

export function buildProvisionalStalkerPlaylist(
    form: StalkerImportFormValue
): Playlist {
    const sourceUrl = required(form.portalUrl);
    const identity = normalizeStalkerPortalIdentity({
        serialNumber: optional(form.serialNumber),
        deviceId1: optional(form.deviceId1),
        deviceId2: optional(form.deviceId2),
        signature1: optional(form.signature1),
        signature2: optional(form.signature2),
    });
    const userAgent = optional(form.userAgent);
    const importDate = required(form.importDate);

    return {
        _id: required(form._id),
        autoRefresh: false,
        count: 0,
        importDate,
        lastUsage: importDate,
        macAddress: required(form.macAddress),
        portalUrl: sourceUrl,
        stalkerProfilePreset: { ...DEFAULT_PROFILE_PRESET },
        stalkerSourceUrl: sourceUrl,
        title: required(form.title),
        ...(hasIdentity(identity)
            ? {
                  stalkerIdentityOverrides: identity,
                  ...legacyIdentityFields(identity),
              }
            : {}),
        ...(userAgent === undefined
            ? {}
            : {
                  stalkerTransportConfiguration: { userAgent },
                  userAgent,
              }),
    };
}

export function readStalkerCredentialCandidate(
    form: Pick<StalkerImportFormValue, 'password' | 'username'>
): StalkerAcceptedCredentials | undefined {
    const username = optional(form.username);
    if (username === undefined) {
        return undefined;
    }
    return {
        password: form.password ?? '',
        username,
    };
}

export function applyStalkerReadyOutcome(
    provisional: Playlist,
    outcome: StalkerImportReadyOutcome,
    credentials?: StalkerAcceptedCredentials
): Playlist {
    const persistence = outcome.persistenceDraft;
    const accountInfo =
        outcome.recipe === 'full-session'
            ? mapAccountSummary(outcome.accountSummary)
            : undefined;
    const playlist: Playlist = {
        ...provisional,
        ...persistence,
        portalUrl: persistence.portalUrl,
        ...(credentials === undefined ? {} : credentials),
        ...(accountInfo === undefined
            ? {}
            : { stalkerAccountInfo: accountInfo }),
    };
    delete playlist.stalkerToken;
    return playlist;
}

export function isStalkerReadyOutcome(
    outcome: StalkerSessionConnectionOutcome
): outcome is StalkerImportReadyOutcome {
    return outcome.kind === 'ready';
}

function mapAccountSummary(
    summary: StalkerSessionAccountSummary | undefined
): Playlist['stalkerAccountInfo'] | undefined {
    if (summary === undefined) {
        return undefined;
    }
    const expireDate = parseExpiry(summary.expiresAt);
    return compact({
        expireDate,
        login: summary.name,
        status: summary.status,
        tariffPlanName: summary.tariffPlan,
    });
}

function parseExpiry(value: string | undefined): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) {
        return numeric;
    }
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
        ? Math.floor(timestamp / 1_000)
        : undefined;
}

function legacyIdentityFields(
    identity: StalkerSessionIdentityOverrides
): Partial<Playlist> {
    return {
        ...(identity.serialNumber === undefined
            ? {}
            : { stalkerSerialNumber: identity.serialNumber }),
        ...(identity.deviceId1 === undefined
            ? {}
            : { stalkerDeviceId1: identity.deviceId1 }),
        ...(identity.deviceId2 === undefined
            ? {}
            : { stalkerDeviceId2: identity.deviceId2 }),
        ...(identity.signature1 === undefined
            ? {}
            : { stalkerSignature1: identity.signature1 }),
        ...(identity.signature2 === undefined
            ? {}
            : { stalkerSignature2: identity.signature2 }),
    };
}

function hasIdentity(identity: StalkerSessionIdentityOverrides): boolean {
    return Object.keys(identity).length > 0;
}

function optional(value: string | null): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function required(value: string | null): string {
    const present = optional(value);
    if (present === undefined) {
        throw new Error('invalid-stalker-import-value');
    }
    return present;
}

function compact<T extends object>(value: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined) {
            result[key] = entry;
        }
    }
    return result as T;
}
