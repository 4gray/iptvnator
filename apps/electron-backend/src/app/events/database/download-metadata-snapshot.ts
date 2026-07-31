import type {
    DownloadEpisodeMetadata,
    DownloadMetadataPerson,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';
import { normalizeDownloadArtworkUrl } from './download-artwork-url';
import { assertSafeDownloadMetadataInput } from './download-metadata-input-safety';

export const DOWNLOAD_METADATA_MAX_BYTES = 128 * 1024;

const MAX_PEOPLE = 30;
const MAX_GENRES = 20;

function invalidSnapshot(): never {
    throw new Error('Invalid download metadata snapshot');
}

function oversizedSnapshot(): never {
    throw new Error('Download metadata snapshot is too large');
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return invalidSnapshot();
    }
    return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
        return invalidSnapshot();
    }
    return value.trim();
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        return invalidSnapshot();
    }
    return value.trim();
}

function optionalInteger(value: unknown): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return invalidSnapshot();
    }
    return value;
}

function optionalFiniteNumber(value: unknown): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ) {
        return value;
    }
    return invalidSnapshot();
}

function normalizeGenres(value: unknown): string[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        return invalidSnapshot();
    }
    return value.slice(0, MAX_GENRES).map(requiredString);
}

function normalizePerson(value: unknown): DownloadMetadataPerson {
    const person = asRecord(value);
    const tmdbPersonId = optionalInteger(person.tmdbPersonId);
    const role = optionalString(person.role);
    const profileUrl = normalizeDownloadArtworkUrl(person.profileUrl);
    return {
        ...(tmdbPersonId === undefined ? {} : { tmdbPersonId }),
        name: requiredString(person.name),
        ...(role === undefined ? {} : { role }),
        ...(profileUrl === undefined ? {} : { profileUrl }),
    };
}

function normalizePeople(value: unknown): DownloadMetadataPerson[] | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value)) {
        return invalidSnapshot();
    }
    return value.slice(0, MAX_PEOPLE).map(normalizePerson);
}

function normalizeEpisode(value: unknown): DownloadEpisodeMetadata | undefined {
    if (value === undefined) {
        return undefined;
    }
    const episode = asRecord(value);
    const title = optionalString(episode.title);
    const plot = optionalString(episode.plot);
    const stillUrl = normalizeDownloadArtworkUrl(episode.stillUrl);
    const seasonNumber = optionalInteger(episode.seasonNumber);
    const episodeNumber = optionalInteger(episode.episodeNumber);
    if (seasonNumber === undefined || episodeNumber === undefined) {
        return invalidSnapshot();
    }
    return {
        ...(title === undefined ? {} : { title }),
        ...(plot === undefined ? {} : { plot }),
        ...(stillUrl === undefined ? {} : { stillUrl }),
        seasonNumber,
        episodeNumber,
    };
}

function normalizeDownloadMetadataSnapshot(
    input: unknown
): DownloadMetadataSnapshot {
    assertSafeDownloadMetadataInput(input, DOWNLOAD_METADATA_MAX_BYTES);
    const source = asRecord(input);
    if (
        source.version !== 1 ||
        (source.mediaKind !== 'movie' && source.mediaKind !== 'series')
    ) {
        return invalidSnapshot();
    }

    const originalTitle = optionalString(source.originalTitle);
    const plot = optionalString(source.plot);
    const releaseDate = optionalString(source.releaseDate);
    const year = optionalInteger(source.year);
    const durationMinutes = optionalInteger(source.durationMinutes);
    const genres = normalizeGenres(source.genres);
    const rating = optionalFiniteNumber(source.rating);
    const status = optionalString(source.status);
    const posterUrl = normalizeDownloadArtworkUrl(source.posterUrl);
    const backdropUrl = normalizeDownloadArtworkUrl(source.backdropUrl);
    const tmdbId = optionalInteger(source.tmdbId);
    const providerCategoryId = optionalString(source.providerCategoryId);
    const cast = normalizePeople(source.cast);
    const creators = normalizePeople(source.creators);
    const episode = normalizeEpisode(source.episode);
    const enrichedAt = optionalString(source.enrichedAt);

    return {
        version: 1,
        language: requiredString(source.language),
        mediaKind: source.mediaKind,
        title: requiredString(source.title),
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
        ...(episode === undefined ? {} : { episode }),
        ...(enrichedAt === undefined ? {} : { enrichedAt }),
    };
}

export function encodeDownloadMetadataSnapshot(
    input: DownloadMetadataSnapshot
): string {
    let snapshot: DownloadMetadataSnapshot;
    try {
        snapshot = normalizeDownloadMetadataSnapshot(input);
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'Download metadata snapshot is too large'
        ) {
            throw error;
        }
        return invalidSnapshot();
    }
    const encoded = JSON.stringify(snapshot);
    if (Buffer.byteLength(encoded, 'utf8') > DOWNLOAD_METADATA_MAX_BYTES) {
        return oversizedSnapshot();
    }
    return encoded;
}

export function assertDownloadMetadataMatchesContentType(
    metadataSnapshot: DownloadMetadataSnapshot,
    contentType: string
): void {
    if (
        (contentType !== 'vod' && contentType !== 'episode') ||
        (contentType === 'vod' && metadataSnapshot.mediaKind !== 'movie') ||
        (contentType === 'episode' && metadataSnapshot.mediaKind !== 'series')
    ) {
        invalidSnapshot();
    }
}

export function decodeDownloadMetadataSnapshot(
    value: string | null | undefined
): DownloadMetadataSnapshot | undefined {
    if (
        !value ||
        Buffer.byteLength(value, 'utf8') > DOWNLOAD_METADATA_MAX_BYTES
    ) {
        return undefined;
    }
    try {
        return normalizeDownloadMetadataSnapshot(JSON.parse(value));
    } catch {
        return undefined;
    }
}
