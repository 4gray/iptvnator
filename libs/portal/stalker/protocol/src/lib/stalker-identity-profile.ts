import { STALKER_FAILURE_REASONS } from './stalker-protocol.constants';
import type {
    StalkerIdentityProfile,
    StalkerIdentityProfileInput,
} from './stalker-protocol.types';

export const MAG250_MINIMAL_PROFILE_ID =
    'mag250-public-5_1-minimal-v1' as const;
export const MAG250_MINIMAL_PROFILE_VERSION = 1 as const;
export const MAG250_LEGACY_BROWSER_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';
export const MAG250_X_USER_AGENT = 'Model: MAG250';

const MAC_PATTERN = /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/;

export function createStalkerIdentityProfile(
    input: StalkerIdentityProfileInput
): StalkerIdentityProfile {
    const macAddress = normalizeStalkerMacAddress(input.macAddress);
    const locale = normalizeLocale(input.locale);
    const language = normalizeLanguage(input.language, locale);
    const timezone = input.timezone?.trim() || 'UTC';
    const serialNumber = presentValue(input.serialNumber);
    const deviceId1 = presentValue(input.deviceId1);
    const deviceId2 = presentValue(input.deviceId2);
    const signature1 = presentValue(input.signature1);
    const signature2 = presentValue(input.signature2);
    const handshakeRandom = presentValue(input.handshakeRandom);

    const headers: Record<string, string> = {
        'Accept-Language': locale,
        'User-Agent': input.userAgent ?? MAG250_LEGACY_BROWSER_USER_AGENT,
        'X-User-Agent': input.xUserAgent ?? MAG250_X_USER_AGENT,
    };
    if (presentValue(input.referer)) headers['Referer'] = input.referer as string;
    if (presentValue(input.origin)) headers['Origin'] = input.origin as string;

    const profileParameters: Record<string, string | number> = {
        client_type: 'STB',
        hd: 1,
        language,
        stb_type: 'MAG250',
        timezone,
    };
    assignPresent(profileParameters, 'sn', serialNumber);
    assignPresent(profileParameters, 'device_id', deviceId1);
    assignPresent(profileParameters, 'device_id2', deviceId2);
    assignPresent(profileParameters, 'signature', signature1);
    assignPresent(profileParameters, 'signature2', signature2);
    assignPresent(
        profileParameters,
        'prehash',
        presentValue(input.prehash)
    );
    assignPresent(
        profileParameters,
        'api_signature',
        presentValue(input.apiSignature)
    );
    assignPresent(
        profileParameters,
        'ver',
        presentValue(input.firmwareVersion)
    );
    assignPresent(
        profileParameters,
        'image_version',
        presentValue(input.imageVersion)
    );
    assignPresent(
        profileParameters,
        'hw_version',
        presentValue(input.hardwareVersion)
    );
    assignPresent(
        profileParameters,
        'hw_version_2',
        presentValue(input.hardwareVersion2)
    );
    assignPresent(
        profileParameters,
        'num_banks',
        presentValue(input.numberOfBanks)
    );
    assignPresent(
        profileParameters,
        'video_out',
        presentValue(input.videoOutput)
    );

    const metrics: Record<string, string | number> = {
        mac: macAddress,
        model: 'MAG250',
        type: 'STB',
    };
    assignPresent(metrics, 'random', handshakeRandom);
    assignPresent(metrics, 'sn', serialNumber);
    assignPresent(metrics, 'uid', deviceId2);

    return {
        headers,
        macAddress,
        managedCookies: {
            mac: macAddress,
            stb_lang: language,
            timezone,
        },
        metrics,
        preset: {
            id: MAG250_MINIMAL_PROFILE_ID,
            version: MAG250_MINIMAL_PROFILE_VERSION,
        },
        profileParameters,
    };
}

export function normalizeStalkerMacAddress(macAddress: string): string {
    const normalized = macAddress.replace(/-/g, ':').toUpperCase();
    if (!MAC_PATTERN.test(normalized)) {
        throw new Error(STALKER_FAILURE_REASONS.InvalidIdentityInput);
    }
    return normalized;
}

function normalizeLocale(value: string | undefined): string {
    const segments = (value?.trim() || 'en-US')
        .replace(/_/g, '-')
        .split('-')
        .filter(Boolean);
    if (segments.length === 0) return 'en-US';
    return segments
        .map((segment, index) => {
            if (index === 0) return segment.toLowerCase();
            if (index === 1 && segment.length === 2) return segment.toUpperCase();
            return segment;
        })
        .join('-');
}

function normalizeLanguage(
    language: string | undefined,
    locale: string
): string {
    return (language?.trim() || locale.split('-')[0] || 'en').toLowerCase();
}

function presentValue(value: string | undefined): string | undefined {
    return value !== undefined && value.trim() !== '' ? value : undefined;
}

function assignPresent(
    target: Record<string, string | number>,
    key: string,
    value: string | undefined
): void {
    if (value !== undefined) target[key] = value;
}
