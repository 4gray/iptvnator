import {
    buildStalkerSerialCfduid,
    normalizeStalkerSerialNumber,
} from '@iptvnator/shared/interfaces';

const STALKER_MAG_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';
const STALKER_STREAM_USER_AGENT = 'KSPlayer';
const STALKER_STREAM_RANGE_HEADER = 'bytes=0-';

const CONTEXT_TTL_MS = 15 * 60 * 1000;

type PlaybackContext = {
    headers: Record<string, string>;
    createdAt: number;
};

const playbackContextByStream = new Map<string, PlaybackContext>();
const playbackContextByOrigin = new Map<string, PlaybackContext>();

function normalizeStreamUrl(streamUrl: string): string {
    const normalized = String(streamUrl ?? '').trim();
    if (!normalized) return '';

    const spaceIndex = normalized.indexOf(' ');
    const maybeWrapped =
        spaceIndex > 0 ? normalized.slice(spaceIndex + 1).trim() : normalized;

    try {
        const parsed = new URL(maybeWrapped);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return maybeWrapped.split('?')[0];
    }
}

function getOrigin(streamUrl: string): string {
    const normalized = String(streamUrl ?? '').trim();
    if (!normalized) return '';
    const spaceIndex = normalized.indexOf(' ');
    const maybeWrapped =
        spaceIndex > 0 ? normalized.slice(spaceIndex + 1).trim() : normalized;
    try {
        return new URL(maybeWrapped).origin;
    } catch {
        return '';
    }
}

function removeExpiredContextEntries() {
    const now = Date.now();
    for (const [key, value] of playbackContextByStream.entries()) {
        if (now - value.createdAt > CONTEXT_TTL_MS) {
            playbackContextByStream.delete(key);
        }
    }
    for (const [key, value] of playbackContextByOrigin.entries()) {
        if (now - value.createdAt > CONTEXT_TTL_MS) {
            playbackContextByOrigin.delete(key);
        }
    }
}

export function rememberStalkerPlaybackContext(input: {
    streamUrl: string;
    portalUrl: string;
    macAddress: string;
    serialNumber?: string;
    token?: string;
}) {
    const streamKey = normalizeStreamUrl(input.streamUrl);
    if (!streamKey || !input.macAddress) return;

    const serialNumber = normalizeStalkerSerialNumber(input.serialNumber);
    const cookieParts = [
        `mac=${input.macAddress}`,
        'stb_lang=en_US@rg=dezzzz',
        'timezone=Europe/Berlin',
    ];

    if (serialNumber) {
        cookieParts.push(`__cfduid=${buildStalkerSerialCfduid(serialNumber)}`);
    }

    const streamOrigin = getOrigin(input.streamUrl) || undefined;

    let portalOrigin: string | undefined;
    try {
        portalOrigin = new URL(input.portalUrl).origin;
    } catch {
        portalOrigin = undefined;
    }

    const crossOriginStream =
        Boolean(streamOrigin) &&
        Boolean(portalOrigin) &&
        streamOrigin !== portalOrigin;

    const headers: Record<string, string> = crossOriginStream
        ? {
              // Align with known working clients for direct tokenized stream URLs.
              'User-Agent': STALKER_STREAM_USER_AGENT,
              Accept: '*/*',
              Range: STALKER_STREAM_RANGE_HEADER,
              'Icy-MetaData': '1',
              Connection: 'keep-alive',
          }
        : {
              Cookie: cookieParts.join('; '),
              'User-Agent': STALKER_MAG_USER_AGENT,
              'X-User-Agent': STALKER_MAG_USER_AGENT,
          };

    if (!crossOriginStream && portalOrigin) {
        headers['Origin'] = portalOrigin;
        headers['Referer'] = portalOrigin;
    }

    if (!crossOriginStream && serialNumber) {
        headers['SN'] = serialNumber;
    }

    if (!crossOriginStream && input.token) {
        headers['Authorization'] = `Bearer ${input.token}`;
    }

    playbackContextByStream.set(streamKey, {
        headers,
        createdAt: Date.now(),
    });
    if (streamOrigin) {
        playbackContextByOrigin.set(streamOrigin, {
            headers,
            createdAt: Date.now(),
        });
    }
    removeExpiredContextEntries();
}

export function getStalkerPlaybackContextHeaders(
    streamUrl: string
): Record<string, string> | null {
    removeExpiredContextEntries();
    const streamKey = normalizeStreamUrl(streamUrl);
    if (streamKey) {
        const entry = playbackContextByStream.get(streamKey);
        if (entry) {
            return { ...entry.headers };
        }
    }

    const origin = getOrigin(streamUrl);
    if (!origin) return null;
    const originEntry = playbackContextByOrigin.get(origin);
    return originEntry ? { ...originEntry.headers } : null;
}
