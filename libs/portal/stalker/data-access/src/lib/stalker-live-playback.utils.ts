import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    buildStalkerSerialCfduid,
    normalizeStalkerSerialNumber,
} from './stalker-identity.utils';

export const STALKER_MAG_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';
export const STALKER_STREAM_USER_AGENT = 'KSPlayer';

export function getStalkerPortalOrigin(
    playlist: PlaylistMeta | undefined | null
): string | undefined {
    const portalUrl = playlist?.portalUrl;
    if (!portalUrl) {
        return undefined;
    }

    try {
        return new URL(portalUrl).origin;
    } catch {
        return undefined;
    }
}

export function isCrossOriginStalkerStream(
    playlist: PlaylistMeta | undefined | null,
    streamUrl?: string
): boolean {
    const portalOrigin = getStalkerPortalOrigin(playlist);
    if (!portalOrigin || !streamUrl) {
        return false;
    }

    try {
        return new URL(streamUrl).origin !== portalOrigin;
    } catch {
        return false;
    }
}

export function buildStalkerExternalPlaybackHeaders(
    playlist: PlaylistMeta | undefined | null,
    token?: string | null,
    streamUrl?: string
): Record<string, string> {
    if (!playlist?.macAddress) {
        return {};
    }

    if (isCrossOriginStalkerStream(playlist, streamUrl)) {
        return {
            'User-Agent': STALKER_STREAM_USER_AGENT,
            Accept: '*/*',
            Range: 'bytes=0-',
            Connection: 'keep-alive',
            'Icy-MetaData': '1',
        };
    }

    const cookieParts = [
        `mac=${playlist.macAddress}`,
        'stb_lang=en_US@rg=dezzzz',
        'timezone=Europe/Berlin',
    ];
    const serialNumber = normalizeStalkerSerialNumber(
        playlist.stalkerSerialNumber
    );

    if (serialNumber) {
        cookieParts.push(`__cfduid=${buildStalkerSerialCfduid(serialNumber)}`);
    }

    const headers: Record<string, string> = {
        Cookie: cookieParts.join('; '),
        'X-User-Agent': STALKER_MAG_USER_AGENT,
    };

    if (serialNumber) {
        headers['SN'] = serialNumber;
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const origin = getStalkerPortalOrigin(playlist);
    if (origin) {
        headers['Origin'] = origin;
        headers['Referer'] = origin;
    }

    return Object.entries(headers).reduce<Record<string, string>>(
        (acc, [name, value]) => {
            if (value?.trim()) {
                acc[name] = value;
            }
            return acc;
        },
        {}
    );
}
