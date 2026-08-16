import { and, eq } from 'drizzle-orm';
import { statSync, unlinkSync } from 'fs';
import {
    EmbeddedMpvSession,
    RecordingStartMetadata,
} from '@iptvnator/shared/interfaces';
import { getDatabase } from '../database/connection';
import * as schema from '../database/schema';
import { broadcastRecordingsUpdate } from '../events/database/recording-broadcast';

interface RecordingStartedEvent {
    sessionId: string;
    targetPath: string;
    fallbackChannelName: string;
    metadata?: RecordingStartMetadata;
}

interface OpenRecordingEntry {
    targetPath: string;
    startedAt: string;
    /**
     * Whether any session snapshot reported this recording as active. A
     * successful start may pass through `active: false` snapshots while the
     * async mpv property set settles, so `active: false` alone is not a stop.
     */
    sawActive: boolean;
    rowId: Promise<number | null>;
}

type RecordingFinalStatus = 'completed' | 'interrupted' | 'failed';

/**
 * Persists the lifecycle of embedded-MPV live recordings into the
 * `recordings` table.
 *
 * Explicit start/stop hooks are the only place where the start metadata and
 * the reserved target path are visible deterministically; but three stop
 * paths never call `stopRecording()` (stream-replacement auto-stop, a
 * frame-copy helper crash that leaves `active: true` behind, session
 * error/close) and are only observable on the session snapshot stream —
 * hence the snapshot observer. Rows that survive a hard app kill in status
 * 'recording' are repaired by `reconcileStaleRecordings()` at startup.
 */
export class EmbeddedMpvRecordingTracker {
    private readonly open = new Map<string, OpenRecordingEntry>();
    /** Serializes DB mutations so a fast stop cannot outrun its insert. */
    private chain: Promise<void> = Promise.resolve();

    onRecordingStarted(event: RecordingStartedEvent): void {
        const startedAt = new Date().toISOString();
        const metadata = event.metadata;
        const rowId = this.enqueue(async () => {
            const db = await getDatabase();
            const result = await db.insert(schema.recordings).values({
                sessionId: event.sessionId,
                status: 'recording',
                filePath: event.targetPath,
                channelName:
                    metadata?.channelName?.trim() || event.fallbackChannelName,
                channelLogoUrl: metadata?.channelLogoUrl,
                playlistId: metadata?.playlistId,
                playlistName: metadata?.playlistName,
                sourceType: metadata?.sourceType,
                epgChannelId: metadata?.epgChannelId,
                programTitle: metadata?.currentProgram?.title,
                programDescription: metadata?.currentProgram?.description,
                programStart: metadata?.currentProgram?.start,
                programStop: metadata?.currentProgram?.stop,
                startedAt,
            });
            return Number(result.lastInsertRowid);
        });

        this.open.set(event.sessionId, {
            targetPath: event.targetPath,
            startedAt,
            sawActive: false,
            rowId,
        });
        void rowId.then((id) => {
            if (id !== null) {
                broadcastRecordingsUpdate();
            }
        });
    }

    /** Clean stop through the stop IPC/controls. */
    onRecordingStopped(sessionId: string): void {
        this.finalize(sessionId, 'completed');
    }

    /**
     * Resolves once every mutation enqueued so far has committed.
     *
     * The stop IPC returns the inactive session as soon as mpv acknowledges,
     * while the row's terminal-state update is still queued here. The renderer
     * answers that snapshot with stop enrichment, whose handler only accepts a
     * terminal row — without this barrier it would look the row up too early,
     * get "Recording not found", and silently drop the covered programs.
     */
    whenSettled(): Promise<void> {
        return this.chain;
    }

    /**
     * Snapshot observer, wired into the service's session-update fan-out. It
     * rides the existing 500 ms diffed poll — no timers of its own.
     */
    observeSnapshot(session: EmbeddedMpvSession): void {
        const entry = this.open.get(session.id);
        if (!entry) {
            return;
        }

        if (session.status === 'error' || session.status === 'closed') {
            this.finalize(session.id, 'interrupted');
            return;
        }

        const recording = session.recording;
        if (!recording) {
            return;
        }

        if (recording.active && recording.targetPath === entry.targetPath) {
            entry.sawActive = true;
            return;
        }

        if (recording.active) {
            return;
        }

        if (entry.sawActive) {
            // Recording went active and is now off without an explicit stop:
            // the stream-replacement auto-stop. The file has real bytes.
            this.finalize(session.id, 'completed');
        } else if (recording.error) {
            // The async start failed before the recording ever activated.
            this.finalize(session.id, 'failed', recording.error);
        }
        // else: start still settling — a successful async start passes
        // through active:false snapshots before the property set applies.
    }

    private finalize(
        sessionId: string,
        status: RecordingFinalStatus,
        errorMessage?: string
    ): void {
        const entry = this.open.get(sessionId);
        if (!entry) {
            return;
        }
        this.open.delete(sessionId);

        void this.enqueue(async () => {
            const rowId = await entry.rowId;
            if (rowId === null) {
                return null;
            }

            const fileSize = this.safeFileSize(entry.targetPath);
            let finalStatus: RecordingFinalStatus = status;
            if (fileSize === null || fileSize === 0) {
                // Nothing usable reached the disk — whatever the trigger,
                // the honest terminal state is 'failed'.
                finalStatus = 'failed';
                if (fileSize === 0) {
                    // Empty pre-reserved file; keeping it around would only
                    // produce an unplayable library entry.
                    this.safeUnlink(entry.targetPath);
                }
            }

            const db = await getDatabase();
            await db
                .update(schema.recordings)
                .set({
                    status: finalStatus,
                    endedAt: new Date().toISOString(),
                    fileSizeBytes: fileSize && fileSize > 0 ? fileSize : null,
                    ...(errorMessage ? { errorMessage } : {}),
                    updatedAt: new Date().toISOString(),
                })
                .where(
                    and(
                        eq(schema.recordings.id, rowId),
                        eq(schema.recordings.status, 'recording')
                    )
                );
            return rowId;
        }).then((rowId) => {
            if (rowId !== null) {
                broadcastRecordingsUpdate();
            }
        });
    }

    private enqueue<T>(work: () => Promise<T>): Promise<T | null> {
        const result = this.chain.then(work).catch((error) => {
            console.error('[Recordings] tracker persistence failed:', error);
            return null;
        });
        this.chain = result.then(() => undefined);
        return result;
    }

    private safeFileSize(filePath: string): number | null {
        try {
            const stats = statSync(filePath);
            return stats.isFile() ? stats.size : null;
        } catch {
            return null;
        }
    }

    private safeUnlink(filePath: string): void {
        try {
            unlinkSync(filePath);
        } catch {
            // Best-effort cleanup of the 0-byte reservation.
        }
    }
}

export const embeddedMpvRecordingTracker = new EmbeddedMpvRecordingTracker();
