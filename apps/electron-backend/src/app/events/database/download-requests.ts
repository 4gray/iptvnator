import {
    sanitizeFilename,
    createFileName,
    createHeaders,
    serializeHeaders,
    type StartDownloadRequest,
} from './download-request-options';
export type { StartDownloadRequest } from './download-request-options';
import { recoverStoredCatchupCompletion } from './download-catchup-recover-completion';
import { cleanupStoredCatchupPartial } from './download-catchup-removal';
import { catchupForDownload } from './download-catchup';
import type { ElectronBridgeDownloadStartResult } from '@iptvnator/shared/interfaces';
import { ELECTRON_BRIDGE_DOWNLOAD_START_REASONS } from '@iptvnator/shared/interfaces';
import { eq, sql } from 'drizzle-orm';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { assertRemoteUrlAllowed } from '../url-safety';
import { DownloadDirectoryAuthorizer } from './download-directory-authorization';
import { getDownloadFileAvailabilityWithTimeoutAsync } from './download-file-availability';
import { removePartialDownloadFileAsync } from './download-partial-cleanup';
import { resolveExistingDownloadIdentity } from './download-request-identity';
import {
    assertDownloadMetadataArtworkDiffersFromStream,
    assertDownloadMetadataMatchesContentType,
    decodeDownloadMetadataSnapshot,
    encodeDownloadMetadataSnapshot,
} from './download-metadata-snapshot';
import { enqueueDownload, hasRuntimeDownload } from './download-runtime';

export async function startDownloadRequest(
    data: StartDownloadRequest,
    authorizer: DownloadDirectoryAuthorizer
): Promise<ElectronBridgeDownloadStartResult> {
    const encodedMetadataSnapshot =
        data.metadataSnapshot === undefined
            ? undefined
            : encodeDownloadMetadataSnapshot(data.metadataSnapshot);
    const normalizedMetadataSnapshot =
        encodedMetadataSnapshot === undefined
            ? undefined
            : decodeDownloadMetadataSnapshot(encodedMetadataSnapshot);
    if (
        encodedMetadataSnapshot !== undefined &&
        normalizedMetadataSnapshot === undefined
    ) {
        throw new Error('Invalid download metadata snapshot');
    }
    console.log('[Downloads] Enqueue download:', data.title);
    const db = await getDatabase();

    if (!data.playlistId) {
        throw new Error('playlistId is required for downloads');
    }

    const existingPlaylist = await db
        .select()
        .from(schema.playlists)
        .where(eq(schema.playlists.id, data.playlistId))
        .limit(1);
    const identity = await resolveExistingDownloadIdentity(db, data);
    if (identity.kind === 'conflict') {
        return {
            error: 'Download identity conflict',
            success: false,
        };
    }

    if (identity.kind === 'match') {
        const item = identity.item;
        if (normalizedMetadataSnapshot) {
            assertDownloadMetadataMatchesContentType(
                normalizedMetadataSnapshot,
                item.contentType
            );
            assertDownloadMetadataArtworkDiffersFromStream(
                normalizedMetadataSnapshot,
                item.url
            );
            assertDownloadMetadataArtworkDiffersFromStream(
                normalizedMetadataSnapshot,
                data.url
            );
        }
        if (
            (item.contentType === 'episode' ||
                item.contentType === 'catchup') &&
            item.status === 'completed'
        ) {
            const completedFileAvailability =
                await getDownloadFileAvailabilityWithTimeoutAsync(item);
            if (completedFileAvailability === 'unknown') {
                return {
                    error: 'Could not verify the completed download file',
                    id: item.id,
                    success: false,
                };
            }
            if (completedFileAvailability === 'available') {
                return {
                    error: 'Download already completed',
                    id: item.id,
                    reason: ELECTRON_BRIDGE_DOWNLOAD_START_REASONS.AlreadyDownloaded,
                    success: false,
                };
            }
        }
        if (!['completed', 'failed', 'canceled'].includes(item.status)) {
            return {
                error: 'Download already in progress',
                id: item.id,
                reason: 'already-in-progress',
                success: false,
            };
        }

        if (
            await recoverStoredCatchupCompletion(db, item, () =>
                hasRuntimeDownload(item.id)
            )
        ) {
            return {
                id: item.id,
                success: false,
                error: 'Download already completed',
                reason: ELECTRON_BRIDGE_DOWNLOAD_START_REASONS.AlreadyDownloaded,
            };
        }
    }

    // These checks authorize another remote transfer, not reuse of a proven file.
    const catchup = catchupForDownload(data);
    const directory = await authorizer.requireAuthorized(data.downloadFolder);
    await assertRemoteUrlAllowed(data.url, { allowPrivateNetworks: true });
    const fileName = catchup
        ? sanitizeFilename(data.title) + '.ts'
        : createFileName(data.title, data.url);
    const headers = createHeaders(data.headers);

    if (identity.kind === 'match') {
        const item = identity.item;
        if (
            ['completed', 'failed', 'canceled'].includes(item.status) &&
            item.filePath
        ) {
            // A terminal row can still reference a retained .part; delete it
            // before the restart clears filePath, or the file is orphaned.
            // An unavailable or slow .part must keep its database owner.
            const cleaned =
                item.contentType === 'catchup'
                    ? await cleanupStoredCatchupPartial(
                          db,
                          item.id,
                          item.filePath,
                          'incomplete'
                      )
                    : (await removePartialDownloadFileAsync(item.filePath)) !==
                      'unknown';
            if (!cleaned) {
                console.error(
                    '[Downloads] Could not verify retained partial cleanup'
                );
                return {
                    error: 'Could not delete the previous partial file',
                    id: item.id,
                    success: false,
                };
            }
        }

        await db
            .update(schema.downloads)
            .set({
                catchup,
                programmeStart: catchup?.startTimestamp ?? 0,
                bytesDownloaded: 0,
                errorMessage: null,
                fileName,
                filePath: null,
                ...(encodedMetadataSnapshot === undefined
                    ? {}
                    : { metadataSnapshot: encodedMetadataSnapshot }),
                requestHeaders: serializeHeaders(headers),
                resumeValidator: null,
                status: 'queued',
                totalBytes: null,
                updatedAt: sql`CURRENT_TIMESTAMP`,
                url: data.url,
                ...(identity.migrateCanonicalId
                    ? { xtreamId: data.xtreamId }
                    : {}),
                ...(data.episodeIdentityScope === undefined
                    ? {}
                    : { episodeIdentityScope: data.episodeIdentityScope }),
            })
            .where(eq(schema.downloads.id, item.id));
        enqueueDownload({
            catchup,
            directory,
            fileName,
            headers,
            id: item.id,
            url: data.url,
        });
        return { id: item.id, success: true };
    }

    if (normalizedMetadataSnapshot) {
        assertDownloadMetadataMatchesContentType(
            normalizedMetadataSnapshot,
            data.contentType
        );
        assertDownloadMetadataArtworkDiffersFromStream(
            normalizedMetadataSnapshot,
            data.url
        );
    }
    if (existingPlaylist.length === 0) {
        console.log(
            '[Downloads] Creating playlist entry for:',
            data.playlistId
        );
        await db.insert(schema.playlists).values({
            id: data.playlistId,
            macAddress: data.macAddress,
            name: data.playlistName || 'Unknown Playlist',
            serverUrl: data.serverUrl,
            type: data.playlistType || 'stalker',
            url: data.portalUrl,
        });
    }

    const result = await db.insert(schema.downloads).values({
        contentType: data.contentType,
        catchup,
        programmeStart: catchup?.startTimestamp ?? 0,
        episodeNumber: data.episodeNumber,
        episodeIdentityScope: data.episodeIdentityScope,
        fileName,
        metadataSnapshot: encodedMetadataSnapshot,
        playlistId: data.playlistId,
        posterUrl: data.posterUrl,
        requestHeaders: serializeHeaders(headers),
        seasonNumber: data.seasonNumber,
        seriesXtreamId: data.seriesXtreamId,
        status: 'queued',
        title: data.title,
        url: data.url,
        xtreamId: data.xtreamId,
    });
    const insertedId = Number(result.lastInsertRowid);
    enqueueDownload({
        catchup,
        directory,
        fileName,
        headers,
        id: insertedId,
        url: data.url,
    });
    return { id: insertedId, success: true };
}

export {
    retryDownloadRequest,
    resumeDownloadRequest,
} from './download-resume-requests';
