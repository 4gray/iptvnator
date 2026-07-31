import type {
    DownloadEpisodeMetadata,
    DownloadMetadataPerson,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';

const MAX_PEOPLE = 30;
const MAX_GENRES = 20;
const STREAM_EXTENSION = /\.(?:m3u8?|mpd|mp4|mkv|mov|ts|webm)(?:$|[?#])/i;
const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const TRUSTED_IMAGE_HOSTS = new Set(['image.tmdb.org', 'picsum.photos']);
const IMAGE_PATH_HINTS = new Set([
    'backdrop',
    'backdrops',
    'cover',
    'covers',
    'getimage',
    'image',
    'images',
    'logo',
    'logos',
    'poster',
    'posters',
    'still',
    'stills',
]);
// Keep these aliases synchronized with the canonical Electron validator in
// apps/electron-backend/src/app/events/database/download-artwork-url.ts.
const CREDENTIAL_PATH_KEYS = new Set([
    'accesskey',
    'accesstoken',
    'apikey',
    'auth',
    'authentication',
    'authorization',
    'cookie',
    'credential',
    'credentials',
    'devicemac',
    'key',
    'mac',
    'macaddress',
    'oauth',
    'password',
    'passwd',
    'privatekey',
    'refreshtoken',
    'secret',
    'secretkey',
    'session',
    'sig',
    'signature',
    'signingkey',
    'token',
    'username',
]);
const CREDENTIAL_QUERY_TERMS = [
    'authentication',
    'authorization',
    'cookie',
    'credential',
    'macaddress',
    'oauth',
    'password',
    'passwd',
    'secret',
    'session',
    'signature',
    'token',
    'username',
];

interface DownloadSnapshotFields {
    language: string;
    title: string;
    originalTitle?: string;
    plot?: string;
    releaseDate?: string;
    year?: number;
    durationMinutes?: number;
    genres?: readonly string[];
    rating?: number;
    status?: string;
    posterUrl?: string;
    backdropUrl?: string;
    tmdbId?: number;
    providerCategoryId?: string;
    cast?: readonly DownloadMetadataPerson[];
    creators?: readonly DownloadMetadataPerson[];
    enrichedAt?: string;
}

export type DownloadMovieSnapshotInput = DownloadSnapshotFields;

export interface DownloadSeriesEpisodeSnapshotInput extends DownloadSnapshotFields {
    episode: DownloadEpisodeMetadata;
}

function text(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function finite(value: number | undefined): number | undefined {
    return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function normalizedToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isCredentialQueryKey(key: string): boolean {
    const token = normalizedToken(key);
    return (
        ['auth', 'key', 'mac', 'sig'].includes(token) ||
        token.endsWith('auth') ||
        token.endsWith('mac') ||
        CREDENTIAL_QUERY_TERMS.some((term) => token.includes(term)) ||
        ['accesskey', 'apikey', 'privatekey', 'secretkey', 'signingkey'].some(
            (term) => token.includes(term)
        )
    );
}

function credentialPath(pathname: string): boolean {
    return pathname
        .split('/')
        .filter(Boolean)
        .some((segment) => {
            const separator = segment.search(/[=:]/);
            const key = separator < 0 ? segment : segment.slice(0, separator);
            return CREDENTIAL_PATH_KEYS.has(normalizedToken(key));
        });
}

function positiveImageSignal(url: URL, pathname: string): boolean {
    let imageAction = false;
    url.searchParams.forEach((value, key) => {
        imageAction ||=
            ['action', 'method'].includes(normalizedToken(key)) &&
            ['getimage', 'image'].includes(normalizedToken(value));
    });
    return (
        IMAGE_EXTENSION.test(pathname) ||
        TRUSTED_IMAGE_HOSTS.has(url.hostname) ||
        pathname
            .split('/')
            .filter(Boolean)
            .some((segment) =>
                IMAGE_PATH_HINTS.has(normalizedToken(segment))
            ) ||
        imageAction
    );
}

function integer(value: number | undefined): number | undefined {
    return value !== undefined && Number.isSafeInteger(value)
        ? value
        : undefined;
}

function artworkUrl(value: string | undefined): string | undefined {
    const normalized = text(value);
    if (!normalized || STREAM_EXTENSION.test(normalized)) {
        return undefined;
    }

    try {
        const url = new URL(normalized);
        const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, '');
        if (
            (url.protocol !== 'http:' && url.protocol !== 'https:') ||
            url.username ||
            url.password ||
            url.hash ||
            credentialPath(pathname) ||
            !positiveImageSignal(url, pathname)
        ) {
            return undefined;
        }
        let hasCredentialQuery = false;
        url.searchParams.forEach((_value, key) => {
            if (isCredentialQueryKey(key)) {
                hasCredentialQuery = true;
            }
        });
        if (hasCredentialQuery) {
            return undefined;
        }
        return normalized;
    } catch {
        return undefined;
    }
}

function stringList(
    values: readonly string[] | undefined,
    limit: number
): string[] | undefined {
    if (!values) {
        return undefined;
    }
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const entry = text(value);
        if (!entry || seen.has(entry)) {
            continue;
        }
        seen.add(entry);
        normalized.push(entry);
        if (normalized.length === limit) {
            break;
        }
    }
    return normalized.length > 0 ? normalized : undefined;
}

function person(value: DownloadMetadataPerson): DownloadMetadataPerson | null {
    const name = text(value.name);
    if (!name) {
        return null;
    }
    const tmdbPersonId = integer(value.tmdbPersonId);
    const role = text(value.role);
    const profileUrl = artworkUrl(value.profileUrl);
    return {
        ...(tmdbPersonId === undefined ? {} : { tmdbPersonId }),
        name,
        ...(role === undefined ? {} : { role }),
        ...(profileUrl === undefined ? {} : { profileUrl }),
    };
}

function people(
    values: readonly DownloadMetadataPerson[] | undefined
): DownloadMetadataPerson[] | undefined {
    if (!values) {
        return undefined;
    }
    const normalized: DownloadMetadataPerson[] = [];
    for (const value of values) {
        const entry = person(value);
        if (entry) {
            normalized.push(entry);
        }
        if (normalized.length === MAX_PEOPLE) {
            break;
        }
    }
    return normalized.length > 0 ? normalized : undefined;
}

function episode(value: DownloadEpisodeMetadata): DownloadEpisodeMetadata {
    const title = text(value.title);
    const plot = text(value.plot);
    const stillUrl = artworkUrl(value.stillUrl);
    return {
        ...(title === undefined ? {} : { title }),
        ...(plot === undefined ? {} : { plot }),
        ...(stillUrl === undefined ? {} : { stillUrl }),
        seasonNumber: value.seasonNumber,
        episodeNumber: value.episodeNumber,
    };
}

function snapshotFields(input: DownloadSnapshotFields) {
    const originalTitle = text(input.originalTitle);
    const plot = text(input.plot);
    const releaseDate = text(input.releaseDate);
    const year = integer(input.year);
    const durationMinutes = integer(input.durationMinutes);
    const genres = stringList(input.genres, MAX_GENRES);
    const rating = finite(input.rating);
    const status = text(input.status);
    const posterUrl = artworkUrl(input.posterUrl);
    const backdropUrl = artworkUrl(input.backdropUrl);
    const tmdbId = integer(input.tmdbId);
    const providerCategoryId = text(input.providerCategoryId);
    const cast = people(input.cast);
    const creators = people(input.creators);

    return {
        version: 1 as const,
        language: input.language.trim(),
        title: input.title.trim(),
        ...(originalTitle === undefined ? {} : { originalTitle }),
        ...(plot === undefined ? {} : { plot }),
        ...(releaseDate === undefined ? {} : { releaseDate }),
        ...(year === undefined ? {} : { year }),
        ...(durationMinutes === undefined ? {} : { durationMinutes }),
        ...(genres === undefined ? {} : { genres }),
        ...(rating === undefined ? {} : { rating }),
        ...(status === undefined ? {} : { status }),
        ...(posterUrl === undefined ? {} : { posterUrl }),
        ...(backdropUrl === undefined ? {} : { backdropUrl }),
        ...(tmdbId === undefined ? {} : { tmdbId }),
        ...(providerCategoryId === undefined ? {} : { providerCategoryId }),
        ...(cast === undefined ? {} : { cast }),
        ...(creators === undefined ? {} : { creators }),
        enrichedAt: text(input.enrichedAt) ?? new Date().toISOString(),
    };
}

export function createMovieDownloadSnapshot(
    input: DownloadMovieSnapshotInput
): DownloadMetadataSnapshot {
    return { ...snapshotFields(input), mediaKind: 'movie' };
}

export function createSeriesEpisodeDownloadSnapshot(
    input: DownloadSeriesEpisodeSnapshotInput
): DownloadMetadataSnapshot {
    return {
        ...snapshotFields(input),
        mediaKind: 'series',
        episode: episode(input.episode),
    };
}
