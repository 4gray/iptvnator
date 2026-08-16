import type {
    ElectronRecordingItem,
    RecordingProgramSnapshot,
} from '@iptvnator/shared/interfaces';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ipcMain, shell } from 'electron';
import { stat, unlink } from 'node:fs/promises';
import { getDatabase } from '../../database/connection';
import * as schema from '../../database/schema';
import { embeddedMpvNativeService } from '../../services/embedded-mpv-native.service';
import { embeddedMpvRecordingTracker } from '../../services/embedded-mpv-recording-tracker';
import {
    getDownloadFileAvailabilityAsync,
    isAvailableDownloadFile,
} from './download-file-availability';
import { broadcastRecordingsUpdate } from './recording-broadcast';
import {
    decodeRecordingPrograms,
    sanitizeRecordingPrograms,
} from './recording-programs';

type RecordingRow = schema.Recording;

/**
 * Bytes on disk for a recording still being written. The tracker only
 * persists `file_size_bytes` at finalization, so the manager's active row
 * would otherwise report nothing while mpv keeps growing the file. At most
 * one recording is active at a time, so this stays a single cheap stat.
 */
async function liveFileSizeBytes(filePath: string): Promise<number | null> {
    try {
        const stats = await stat(filePath);
        return stats.isFile() ? stats.size : null;
    } catch {
        return null;
    }
}

async function decorateRecordingItem(
    row: RecordingRow
): Promise<ElectronRecordingItem> {
    // Recordings reuse the download availability probe (bounded lstat with
    // in-flight coalescing). 'interrupted' partials are playable files, so
    // they are probed exactly like completed rows; 'recording' and 'failed'
    // map to a non-completed status and come back 'not-applicable'.
    const fileAvailability = await getDownloadFileAvailabilityAsync({
        filePath: row.filePath,
        status:
            row.status === 'completed' || row.status === 'interrupted'
                ? 'completed'
                : 'failed',
    });

    const fileSizeBytes =
        row.status === 'recording'
            ? ((await liveFileSizeBytes(row.filePath)) ?? undefined)
            : (row.fileSizeBytes ?? undefined);

    return {
        id: row.id,
        sessionId: row.sessionId ?? undefined,
        status: row.status,
        filePath: row.filePath,
        fileSizeBytes,
        channelName: row.channelName,
        channelLogoUrl: row.channelLogoUrl ?? undefined,
        playlistId: row.playlistId ?? undefined,
        playlistName: row.playlistName ?? undefined,
        sourceType: row.sourceType ?? undefined,
        epgChannelId: row.epgChannelId ?? undefined,
        programTitle: row.programTitle ?? undefined,
        programDescription: row.programDescription ?? undefined,
        programStart: row.programStart ?? undefined,
        programStop: row.programStop ?? undefined,
        programs: decodeRecordingPrograms(row.programsJson),
        errorMessage: row.errorMessage ?? undefined,
        startedAt: row.startedAt,
        endedAt: row.endedAt ?? undefined,
        createdAt: row.createdAt ?? undefined,
        updatedAt: row.updatedAt ?? undefined,
        fileAvailability,
    };
}

/**
 * Shell-touching IPCs may only operate on paths the main process itself
 * reserved via `reserveRecordingTargetPath` — the renderer-supplied recording
 * directory is a write-location preference, not a shell-access grant.
 */
async function isManagedRecordingFile(filePath: string): Promise<boolean> {
    if (!filePath) {
        return false;
    }
    try {
        const db = await getDatabase();
        const rows = await db
            .select({ id: schema.recordings.id })
            .from(schema.recordings)
            .where(eq(schema.recordings.filePath, filePath))
            .limit(1);
        return rows.length > 0;
    } catch (error) {
        console.error('Error verifying managed recording path:', error);
        return false;
    }
}

ipcMain.handle('RECORDINGS_GET_LIST', async (_event, playlistId?: string) => {
    try {
        const db = await getDatabase();
        const query = db.select().from(schema.recordings);
        const rows = await (playlistId
            ? query
                  .where(eq(schema.recordings.playlistId, playlistId))
                  .orderBy(desc(schema.recordings.startedAt))
            : query.orderBy(desc(schema.recordings.startedAt)));
        return Promise.all(rows.map((row) => decorateRecordingItem(row)));
    } catch (error) {
        console.error('[Recordings] Error getting recording list:', error);
        throw error;
    }
});

ipcMain.handle('RECORDINGS_GET', async (_event, recordingId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.id, recordingId))
            .limit(1);
        return result[0] ? await decorateRecordingItem(result[0]) : null;
    } catch (error) {
        console.error('[Recordings] Error getting recording:', error);
        throw error;
    }
});

ipcMain.handle('RECORDINGS_STOP', async (_event, recordingId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.id, recordingId))
            .limit(1);
        const row = result[0];
        if (!row || row.status !== 'recording' || !row.sessionId) {
            return { error: 'Recording is not active', success: false };
        }
        // Finalization (status, ended_at, file size, broadcast) happens in
        // the recording tracker's stop hook, exactly like a stop from the
        // player controls.
        embeddedMpvNativeService.stopRecording(row.sessionId);
        return { success: true };
    } catch (error) {
        console.error('[Recordings] Error stopping recording:', error);
        return {
            error: error instanceof Error ? error.message : 'Stop failed',
            success: false,
        };
    }
});

ipcMain.handle('RECORDINGS_REMOVE', async (_event, recordingId: number) => {
    try {
        const db = await getDatabase();
        const result = await db
            .select()
            .from(schema.recordings)
            .where(eq(schema.recordings.id, recordingId))
            .limit(1);
        const row = result[0];
        if (!row) {
            return { error: 'Recording not found', success: false };
        }
        if (row.status === 'recording') {
            return {
                error: 'Stop the recording before removing it',
                success: false,
            };
        }
        // Finished recordings keep their file on disk (same contract as
        // completed downloads); only a failed row's leftover reservation is
        // cleaned up best-effort — and only while no other row claims that
        // path. A retry within the same timestamp second reuses the freed
        // name, and unlinking then would take the newer recording's file
        // (mpv would keep writing to an inode nobody can reach).
        if (row.status === 'failed' && row.filePath) {
            const otherOwners = await db
                .select({ id: schema.recordings.id })
                .from(schema.recordings)
                .where(eq(schema.recordings.filePath, row.filePath))
                .limit(2);
            const pathIsExclusive = otherOwners.every(
                (candidate) => candidate.id === row.id
            );
            if (pathIsExclusive) {
                try {
                    await unlink(row.filePath);
                } catch {
                    // Already gone or inaccessible — the row removal matters.
                }
            }
        }
        await db
            .delete(schema.recordings)
            .where(eq(schema.recordings.id, recordingId));
        broadcastRecordingsUpdate();
        return { success: true };
    } catch (error) {
        console.error('[Recordings] Error removing recording:', error);
        return {
            error: error instanceof Error ? error.message : 'Remove failed',
            success: false,
        };
    }
});

ipcMain.handle(
    'RECORDINGS_UPDATE_PROGRAMS',
    async (
        _event,
        targetPath: string,
        programs: RecordingProgramSnapshot[]
    ) => {
        try {
            const sanitized = sanitizeRecordingPrograms(programs);
            if (!targetPath || sanitized === null) {
                return { error: 'Invalid programs payload', success: false };
            }
            // The stop IPC returns before mpv acknowledges, and the tracker
            // only finalizes on the acknowledged snapshot. Wait (bounded) for
            // this recording to reach a terminal row before looking it up,
            // otherwise the enrichment is dropped as "not found".
            await embeddedMpvRecordingTracker.whenFinalized(targetPath);
            const db = await getDatabase();
            // The reserved path is unique per recording in practice; a
            // historical row could share it after an external delete, so the
            // newest terminal row wins and an active row is never touched.
            const rows = await db
                .select()
                .from(schema.recordings)
                .where(
                    and(
                        eq(schema.recordings.filePath, targetPath),
                        inArray(schema.recordings.status, [
                            'completed',
                            'interrupted',
                        ])
                    )
                )
                .orderBy(desc(schema.recordings.id))
                .limit(1);
            const row = rows[0];
            if (!row) {
                return { error: 'Recording not found', success: false };
            }
            const first = sanitized[0];
            await db
                .update(schema.recordings)
                .set({
                    programsJson: JSON.stringify(sanitized),
                    // Backfill the headline program only when the start
                    // snapshot had none — the program airing at start stays
                    // authoritative for the title.
                    ...(row.programTitle || !first
                        ? {}
                        : {
                              programTitle: first.title,
                              programDescription: first.description,
                              programStart: first.start,
                              programStop: first.stop,
                          }),
                    updatedAt: new Date().toISOString(),
                })
                .where(eq(schema.recordings.id, row.id));
            broadcastRecordingsUpdate();
            return { success: true };
        } catch (error) {
            console.error('[Recordings] Error updating programs:', error);
            return {
                error: error instanceof Error ? error.message : 'Update failed',
                success: false,
            };
        }
    }
);

ipcMain.handle('RECORDINGS_REVEAL_FILE', async (_event, filePath: string) => {
    if (
        !(await isManagedRecordingFile(filePath)) ||
        !isAvailableDownloadFile(filePath)
    ) {
        return { error: 'File not found', success: false };
    }
    shell.showItemInFolder(filePath);
    return { success: true };
});

ipcMain.handle('RECORDINGS_PLAY_FILE', async (_event, filePath: string) => {
    if (
        !(await isManagedRecordingFile(filePath)) ||
        !isAvailableDownloadFile(filePath)
    ) {
        return { error: 'File not found', success: false };
    }
    const error = await shell.openPath(filePath);
    if (!error) {
        return { success: true };
    }
    return isAvailableDownloadFile(filePath)
        ? { error, success: false }
        : { error: 'File not found', success: false };
});
