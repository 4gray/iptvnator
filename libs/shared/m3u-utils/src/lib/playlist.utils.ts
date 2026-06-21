import {
    Channel,
    ParsedPlaylist,
    ParsedPlaylistItem,
    Playlist,
} from '@iptvnator/shared/interfaces';
import { v4 as uuidv4 } from 'uuid';

/**
 * Aggregates favorite channels as objects from all available playlists
 * @param playlists all available playlists
 * @returns an array with favorite channels from all playlists
 */
export function aggregateFavoriteChannels(playlists: Playlist[]): Channel[] {
    const favorites: Channel[] = [];

    for (const playlist of playlists) {
        const favoriteIds = new Set(
            (playlist.favorites ?? []).filter(
                (favorite): favorite is string => typeof favorite === 'string'
            )
        );

        if (favoriteIds.size === 0) {
            continue;
        }

        for (const channel of playlist.playlist?.items ?? []) {
            if (favoriteIds.has(channel.id) || favoriteIds.has(channel.url)) {
                favorites.push(channel);
            }
        }
    }

    return favorites;
}

/**
 * Creates a simplified playlist object which is used for global favorites
 * @param channels channels list
 * @returns simplified playlist object
 */
export function createFavoritesPlaylist(
    channels: Channel[]
): Partial<Playlist> {
    return {
        _id: 'global-favorites',
        count: channels.length,
        playlist: {
            items: channels,
        },
        favorites: channels.map((channel) => channel.url),
        filename: 'Global favorites',
    };
}

/**
 * Returns last segment (part after last slash "/") of the given URL
 * @param value URL as string
 */
export const getFilenameFromUrl = (value: string): string => {
    if (value && value.length > 1) {
        return value.substring(value.lastIndexOf('/') + 1);
    }
    return 'Untitled playlist';
};

const M3U_EPG_HEADER_ATTRS = ['x-tvg-url', 'url-tvg', 'tvg-url'] as const;
const M3U_EPG_URL_PATTERN = /\b(?:https?|file):\/\/[^\s,"']+/gi;
export const M3U_AUTO_IMPORT_EPG_URL_LIMIT = 5;
export const M3U_RECOMMENDED_EPG_URL_LIMIT = 12;

export interface M3uEpgUrlSelection {
    detectedEpgUrls: string[];
    enabledEpgUrls: string[];
}

export interface PlaylistEpgSourceStateInput {
    detectedEpgUrls?: string[];
    enabledEpgUrls?: string[];
    manualEpgUrls?: string[];
    disabledEpgUrls?: string[];
}

export interface PlaylistEpgSourceState {
    detectedEpgUrls: string[];
    epgUrls: string[];
    manualEpgUrls: string[];
    disabledEpgUrls: string[];
}

export function normalizeEpgUrls(
    urls: readonly string[] | undefined
): string[] {
    return Array.from(
        new Set(
            (urls ?? [])
                .map((url) => url.trim())
                .filter((url) => url.length > 0)
        )
    );
}

export function resolvePlaylistEpgSourceState(
    input: PlaylistEpgSourceStateInput
): PlaylistEpgSourceState {
    const detectedEpgUrls = normalizeEpgUrls(input.detectedEpgUrls);
    const manualEpgUrls = normalizeEpgUrls(input.manualEpgUrls);
    const disabledEpgUrls = normalizeEpgUrls(input.disabledEpgUrls);
    const disabledSet = new Set(disabledEpgUrls);
    const epgUrls = normalizeEpgUrls([
        ...normalizeEpgUrls(input.enabledEpgUrls),
        ...manualEpgUrls,
    ]).filter((url) => !disabledSet.has(url));

    return {
        detectedEpgUrls,
        epgUrls,
        manualEpgUrls,
        disabledEpgUrls,
    };
}

export function filterPlaylistEpgUrlsForFetch(
    playlistEpgUrls: readonly string[] | undefined,
    globalEpgUrls: readonly string[] | undefined
): string[] {
    const globalUrlSet = new Set(normalizeEpgUrls(globalEpgUrls));
    return normalizeEpgUrls(playlistEpgUrls).filter(
        (url) => !globalUrlSet.has(url)
    );
}

export function extractM3uEpgUrls(
    playlist: Pick<ParsedPlaylist, 'header'> | null | undefined
): string[] {
    const header = playlist?.header;
    if (!header) {
        return [];
    }

    const candidates: Array<string | undefined> = [];
    for (const attr of M3U_EPG_HEADER_ATTRS) {
        candidates.push(header.attrs?.[attr]);
        candidates.push(extractHeaderAttributeFromRaw(header.raw, attr));
    }

    const urls: string[] = [];
    for (const candidate of candidates) {
        urls.push(...extractUrlsFromHeaderValue(candidate));
    }

    return Array.from(new Set(urls));
}

export function resolveM3uEpgUrlSelection(
    playlist: Pick<ParsedPlaylist, 'header' | 'items'> | null | undefined
): M3uEpgUrlSelection {
    const detectedEpgUrls = extractM3uEpgUrls(playlist);

    if (detectedEpgUrls.length <= M3U_AUTO_IMPORT_EPG_URL_LIMIT) {
        return {
            detectedEpgUrls,
            enabledEpgUrls: detectedEpgUrls,
        };
    }

    const recommendedEpgUrls = selectRecommendedEpgUrls(
        detectedEpgUrls,
        playlist?.items ?? []
    );

    return {
        detectedEpgUrls,
        enabledEpgUrls:
            recommendedEpgUrls.length > 0
                ? recommendedEpgUrls
                : detectedEpgUrls.slice(0, M3U_AUTO_IMPORT_EPG_URL_LIMIT),
    };
}

function extractHeaderAttributeFromRaw(
    raw: string | undefined,
    attr: string
): string | undefined {
    if (!raw) {
        return undefined;
    }

    const match = raw.match(
        new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s]+))`, 'i')
    );

    return match?.[2] ?? match?.[3] ?? match?.[4];
}

function extractUrlsFromHeaderValue(value: string | undefined): string[] {
    if (!value) {
        return [];
    }

    const urls: string[] = [];
    const pattern = new RegExp(M3U_EPG_URL_PATTERN);
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(value)) !== null) {
        const url = match[0].trim();
        if (url.length > 0) {
            urls.push(url);
        }
    }

    return urls;
}

function selectRecommendedEpgUrls(
    urls: string[],
    items: ParsedPlaylistItem[]
): string[] {
    const hints = collectPlaylistEpgRegionHints(items);
    const recommendations: string[] = [];

    for (const url of urls) {
        const guideCodes = extractEpgGuideCodes(url);
        const matchesCountry =
            guideCodes.country !== undefined &&
            hints.countries.has(guideCodes.country);
        const matchesLanguageWithoutCountry =
            hints.countries.size === 0 &&
            guideCodes.language !== undefined &&
            hints.languages.has(guideCodes.language);

        if (matchesCountry || matchesLanguageWithoutCountry) {
            recommendations.push(url);
        }

        if (recommendations.length >= M3U_RECOMMENDED_EPG_URL_LIMIT) {
            break;
        }
    }

    return recommendations;
}

function collectPlaylistEpgRegionHints(items: ParsedPlaylistItem[]): {
    countries: Set<string>;
    languages: Set<string>;
} {
    const countries = new Set<string>();
    const languages = new Set<string>();

    for (const item of items) {
        addDelimitedCodes(
            countries,
            extractExtinfAttribute(item.raw, 'tvg-country')
        );
        addDelimitedCodes(countries, extractCountrySuffix(item.tvg?.id));

        const languageCode = normalizeLanguageCode(
            extractExtinfAttribute(item.raw, 'tvg-language')
        );
        if (languageCode) {
            languages.add(languageCode);
        }
    }

    return { countries, languages };
}

function extractExtinfAttribute(
    raw: string | undefined,
    attr: string
): string | undefined {
    if (!raw) {
        return undefined;
    }

    const match = raw.match(
        new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s,]+))`, 'i')
    );

    return match?.[2] ?? match?.[3] ?? match?.[4];
}

function addDelimitedCodes(target: Set<string>, value: string | undefined) {
    if (!value) {
        return;
    }

    for (const token of value.split(/[;,\s]+/)) {
        const code = normalizeRegionCode(token);
        if (code) {
            target.add(code);
        }
    }
}

function normalizeRegionCode(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();
    return normalized && /^[a-z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizeLanguageCode(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }

    const languageByName: Record<string, string> = {
        arabic: 'ar',
        english: 'en',
        french: 'fr',
        german: 'de',
        italian: 'it',
        polish: 'pl',
        portuguese: 'pt',
        russian: 'ru',
        spanish: 'es',
        turkish: 'tr',
        ukrainian: 'uk',
    };

    return normalizeRegionCode(normalized) ?? languageByName[normalized];
}

function extractCountrySuffix(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }

    const match = normalized.match(/\.([a-z]{2})$/);
    return match?.[1];
}

function extractEpgGuideCodes(url: string): {
    country?: string;
    language?: string;
} {
    let path = '';

    try {
        path = new URL(url).pathname;
    } catch {
        path = url;
    }

    const segments = path
        .split('/')
        .map((segment) => segment.trim().toLowerCase())
        .filter((segment) => segment.length > 0);
    const guidesIndex = segments.indexOf('guides');
    const guideSegment =
        guidesIndex >= 0 ? segments[guidesIndex + 1] : undefined;

    if (!guideSegment) {
        return {};
    }

    const [country, language] = guideSegment.split('-');

    return {
        country: normalizeRegionCode(country),
        language: normalizeRegionCode(language),
    };
}

/**
 * Creates a playlist object
 * @param name name of the playlist
 * @param playlist playlist to save
 * @param urlOrPath absolute fs path or url of the playlist
 * @param uploadType upload type - by file or via an url
 */
export const createPlaylistObject = (
    name: string,
    playlist: ParsedPlaylist,
    urlOrPath?: string,
    uploadType?: 'URL' | 'FILE' | 'TEXT'
): Playlist => {
    const { detectedEpgUrls, enabledEpgUrls } =
        resolveM3uEpgUrlSelection(playlist);
    const epgSourceState = resolvePlaylistEpgSourceState({
        detectedEpgUrls,
        enabledEpgUrls,
    });

    return {
        _id: uuidv4(),
        filename: name,
        title: name,
        count: playlist.items.length,
        playlist: {
            ...playlist,
            items: playlist.items.map((item: ParsedPlaylistItem) => ({
                ...item,
                id: uuidv4(),
            })),
        },
        importDate: new Date().toISOString(),
        lastUsage: new Date().toISOString(),
        favorites: [],
        autoRefresh: false,
        ...(epgSourceState.epgUrls.length > 0
            ? { epgUrls: epgSourceState.epgUrls }
            : {}),
        ...(epgSourceState.detectedEpgUrls.length > 0
            ? { detectedEpgUrls: epgSourceState.detectedEpgUrls }
            : {}),
        ...(uploadType === 'URL' ? { url: urlOrPath } : {}),
        ...(uploadType === 'FILE' ? { filePath: urlOrPath } : {}),
    };
};

/**
 * Extract the file extension from a URL, ignoring query strings and fragments.
 *
 * Returns `undefined` when no real extension is found — e.g. for IPTV proxy
 * URLs like `https://proxy.example.com/ace/getstream?infohash=abc` where the
 * path segment has no dot-separated extension.
 */
export const getExtensionFromUrl = (url: string): string | undefined => {
    const path = url.split(/[#?]/)[0];
    const lastSegment = path.split('/').pop() || '';
    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex < 1) return undefined;
    const ext = lastSegment.slice(dotIndex + 1).trim();
    return ext || undefined;
};

export const getStreamExtensionFromUrl = (url: string): string | undefined => {
    return getExtensionFromUrlQuery(url) ?? getExtensionFromUrl(url);
};

const getExtensionFromUrlQuery = (url: string): string | undefined => {
    try {
        const parsedUrl = new URL(url, 'http://iptvnator.local');
        return normalizeExtensionToken(parsedUrl.searchParams.get('extension'));
    } catch {
        return undefined;
    }
};

const normalizeExtensionToken = (
    value: string | null | undefined
): string | undefined => {
    const extension = value?.trim().replace(/^\.+/, '').toLowerCase();
    return extension || undefined;
};
