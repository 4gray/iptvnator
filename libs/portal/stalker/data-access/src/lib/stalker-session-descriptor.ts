import { normalizeStalkerMacAddress } from '@iptvnator/portal/stalker/protocol';
import {
    LEGACY_DEFAULT_STALKER_SERIAL,
    type Playlist,
    type StalkerSessionConnectionDescriptor,
    type StalkerSessionIdentityOverrides,
    type StalkerSessionProfilePreset,
    type StalkerSessionProvisionalReason,
    type StalkerSessionTransportConfiguration,
} from '@iptvnator/shared/interfaces';

const DEFAULT_PROFILE_PRESET: StalkerSessionProfilePreset = {
    id: 'mag250-public-5_1-minimal-v1',
    version: 1,
};

export type StalkerSessionDescriptorMappingOptions =
    | {
          connectionMode?: 'persisted-open';
          provisionalReason?: never;
      }
    | {
          connectionMode: 'provisional';
          provisionalReason: StalkerSessionProvisionalReason;
      };

export interface StalkerSavedCredentials {
    readonly username: string;
    readonly password: string;
}

export interface StalkerSessionDescriptorMapping {
    readonly descriptor: StalkerSessionConnectionDescriptor;
    readonly savedCredentials?: StalkerSavedCredentials;
}

export function mapPlaylistToStalkerSessionConnection(
    playlist: Playlist,
    options: StalkerSessionDescriptorMappingOptions = {}
): StalkerSessionDescriptorMapping {
    const playlistRef = requiredValue(playlist._id);
    const sourceUrl = requiredValue(
        firstPresent(
            playlist.stalkerSourceUrl,
            playlist.portalUrl,
            playlist.url
        )
    );
    const macAddress = normalizeMac(playlist.macAddress);
    const learnedEndpointHint = presentValue(playlist.portalUrl);
    const identityOverrides = mapIdentityOverrides(playlist);
    const transportConfiguration = mapTransportConfiguration(playlist);
    const base = {
        macAddress,
        playlistRef,
        profilePreset: mapProfilePreset(playlist.stalkerProfilePreset),
        sourceUrl,
        ...(learnedEndpointHint === undefined
            ? {}
            : { learnedEndpointHint }),
        ...(identityOverrides === undefined ? {} : { identityOverrides }),
        ...(transportConfiguration === undefined
            ? {}
            : { transportConfiguration }),
    };

    const descriptor: StalkerSessionConnectionDescriptor =
        options.connectionMode === 'provisional'
            ? {
                  ...base,
                  connectionMode: 'provisional',
                  provisionalReason: options.provisionalReason,
              }
            : {
                  ...base,
                  connectionMode: 'persisted-open',
              };
    const savedCredentials = mapSavedCredentials(playlist);
    return {
        descriptor,
        ...(savedCredentials === undefined ? {} : { savedCredentials }),
    };
}

function mapProfilePreset(
    profilePreset: StalkerSessionProfilePreset | undefined
): StalkerSessionProfilePreset {
    return profilePreset === undefined
        ? { ...DEFAULT_PROFILE_PRESET }
        : { ...profilePreset };
}

function mapIdentityOverrides(
    playlist: Playlist
): StalkerSessionIdentityOverrides | undefined {
    if (playlist.stalkerIdentityOverrides !== undefined) {
        return copyPresentStringValues(playlist.stalkerIdentityOverrides);
    }

    const serialNumber =
        playlist.stalkerSerialNumber?.trim().toUpperCase() ===
        LEGACY_DEFAULT_STALKER_SERIAL
            ? undefined
            : playlist.stalkerSerialNumber;
    return copyPresentStringValues({
        deviceId1: playlist.stalkerDeviceId1,
        deviceId2: playlist.stalkerDeviceId2,
        serialNumber,
        signature1: playlist.stalkerSignature1,
        signature2: playlist.stalkerSignature2,
    });
}

function mapTransportConfiguration(
    playlist: Playlist
): StalkerSessionTransportConfiguration | undefined {
    if (playlist.stalkerTransportConfiguration !== undefined) {
        return copyPresentStringValues(
            playlist.stalkerTransportConfiguration
        );
    }

    return copyPresentStringValues({
        origin: playlist.origin,
        referer: playlist.referrer,
        userAgent: playlist.userAgent,
    });
}

function copyPresentStringValues<T extends object>(source: T): T | undefined {
    const result = Object.fromEntries(
        Object.entries(source).filter(
            ([, value]) =>
                typeof value === 'string' && value.trim().length > 0
        )
    ) as T;
    return Object.keys(result).length > 0 ? result : undefined;
}

function mapSavedCredentials(
    playlist: Playlist
): StalkerSavedCredentials | undefined {
    if (playlist.username === undefined || playlist.username.length === 0) {
        return undefined;
    }
    return {
        password: playlist.password ?? '',
        username: playlist.username,
    };
}

function normalizeMac(value: string | undefined): string {
    if (value === undefined) {
        throw new Error('invalid-identity-input');
    }
    try {
        return normalizeStalkerMacAddress(value);
    } catch {
        throw new Error('invalid-identity-input');
    }
}

function requiredValue(value: string | undefined): string {
    const present = presentValue(value);
    if (present === undefined) {
        throw new Error('invalid-identity-input');
    }
    return present;
}

function firstPresent(
    ...values: readonly (string | undefined)[]
): string | undefined {
    return values.find((value) => presentValue(value) !== undefined);
}

function presentValue(value: string | undefined): string | undefined {
    return value !== undefined && value.trim().length > 0 ? value : undefined;
}
