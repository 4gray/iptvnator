import { and, eq } from 'drizzle-orm';
import * as schema from '../../database/schema';
import type { DownloadsDatabase } from './download-task';

type DownloadRow = typeof schema.downloads.$inferSelect;

export const DOWNLOAD_IDENTITY_KIND = {
    CONFLICT: 'conflict',
    MATCH: 'match',
    NONE: 'none',
} as const;

interface DownloadIdentityNone {
    readonly kind: typeof DOWNLOAD_IDENTITY_KIND.NONE;
}

interface DownloadIdentityConflict {
    readonly kind: typeof DOWNLOAD_IDENTITY_KIND.CONFLICT;
}

interface DownloadIdentityMatch {
    readonly item: DownloadRow;
    readonly kind: typeof DOWNLOAD_IDENTITY_KIND.MATCH;
    readonly migrateCanonicalId: boolean;
}

export type ExistingDownloadIdentityResolution =
    | DownloadIdentityNone
    | DownloadIdentityConflict
    | DownloadIdentityMatch;

export interface DownloadIdentityRequest {
    contentType: DownloadRow['contentType'];
    episodeNumber?: number;
    playlistId: string;
    seasonNumber?: number;
    seriesXtreamId?: number;
    xtreamId: number;
}

function isSafeInteger(value: number | null | undefined): value is number {
    return Number.isSafeInteger(value);
}

function rowHasConflictingCoordinates(
    row: DownloadRow,
    request: Required<
        Pick<
            DownloadIdentityRequest,
            'episodeNumber' | 'seasonNumber' | 'seriesXtreamId'
        >
    >
): boolean {
    const { episodeNumber, seasonNumber, seriesXtreamId } = row;
    if (
        seriesXtreamId === null ||
        seriesXtreamId === undefined ||
        seasonNumber === null ||
        seasonNumber === undefined ||
        episodeNumber === null ||
        episodeNumber === undefined
    ) {
        return false;
    }

    return (
        !isSafeInteger(seriesXtreamId) ||
        !isSafeInteger(seasonNumber) ||
        !isSafeInteger(episodeNumber) ||
        seriesXtreamId !== request.seriesXtreamId ||
        seasonNumber !== request.seasonNumber ||
        episodeNumber !== request.episodeNumber
    );
}

export async function resolveExistingDownloadIdentity(
    db: DownloadsDatabase,
    request: DownloadIdentityRequest
): Promise<ExistingDownloadIdentityResolution> {
    const canonicalRows = await db
        .select()
        .from(schema.downloads)
        .where(
            and(
                eq(schema.downloads.playlistId, request.playlistId),
                eq(schema.downloads.contentType, request.contentType),
                eq(schema.downloads.xtreamId, request.xtreamId)
            )
        )
        .limit(1);
    const canonicalRow = canonicalRows[0];
    const seriesXtreamId = request.seriesXtreamId;
    const seasonNumber = request.seasonNumber;
    const episodeNumber = request.episodeNumber;

    if (
        request.contentType !== 'episode' ||
        !isSafeInteger(seriesXtreamId) ||
        !isSafeInteger(seasonNumber) ||
        !isSafeInteger(episodeNumber)
    ) {
        return canonicalRow
            ? {
                  item: canonicalRow,
                  kind: DOWNLOAD_IDENTITY_KIND.MATCH,
                  migrateCanonicalId: false,
              }
            : { kind: DOWNLOAD_IDENTITY_KIND.NONE };
    }

    const coordinateRows = await db
        .select()
        .from(schema.downloads)
        .where(
            and(
                eq(schema.downloads.playlistId, request.playlistId),
                eq(schema.downloads.contentType, 'episode'),
                eq(schema.downloads.seriesXtreamId, seriesXtreamId),
                eq(schema.downloads.seasonNumber, seasonNumber),
                eq(schema.downloads.episodeNumber, episodeNumber)
            )
        )
        .limit(2);

    if (coordinateRows.length > 1) {
        return { kind: DOWNLOAD_IDENTITY_KIND.CONFLICT };
    }

    const coordinateRow = coordinateRows[0];
    if (
        canonicalRow &&
        coordinateRow &&
        canonicalRow.id !== coordinateRow.id
    ) {
        return { kind: DOWNLOAD_IDENTITY_KIND.CONFLICT };
    }

    if (
        canonicalRow &&
        rowHasConflictingCoordinates(canonicalRow, {
            episodeNumber,
            seasonNumber,
            seriesXtreamId,
        })
    ) {
        return { kind: DOWNLOAD_IDENTITY_KIND.CONFLICT };
    }

    if (canonicalRow) {
        return {
            item: canonicalRow,
            kind: DOWNLOAD_IDENTITY_KIND.MATCH,
            migrateCanonicalId: false,
        };
    }

    if (coordinateRow) {
        return {
            item: coordinateRow,
            kind: DOWNLOAD_IDENTITY_KIND.MATCH,
            migrateCanonicalId: true,
        };
    }

    return { kind: DOWNLOAD_IDENTITY_KIND.NONE };
}
