import { and, eq } from 'drizzle-orm';
import { stat, unlink } from 'node:fs/promises';
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
    sessionId: string;
    targetPath: string;
    startedAt: string;
    /**
     * Whether any session snapshot reported this recording as active. A
     * successful start may pass through `active: false` snapshots while the
     * async mpv property set settles, so `active: false` alone is not a stop.
     */
    sawActive: boolean;
    /** Set once a stop was requested; the acknowledged snapshot finalizes. */
    stopRequested: boolean;
    /** Fires if mpv never acknowledges the requested stop. */
    stopFallbackTimer?: ReturnType<typeof setTimeout>;
    /** Armed by an inactive snapshot; finalizes once the stop looks settled. */
    settleTimer?: ReturnType<typeof setTimeout>;
    /** The stream dropped under this recording; it must not end as `completed`. */
    interrupted: boolean;
    /**
     * Set by the first finalize. Timers hold the entry itself, so an entry
     * replaced in the map (stop → immediate restart on the same session) can
     * still be finalized late — this flag keeps that from happening twice.
     */
    finalized: boolean;
    rowId: Promise<number | null>;
}

type RecordingFinalStatus = 'completed' | 'interrupted' | 'failed';

/**
 * mpv acknowledges a stop asynchronously (`mpv_set_property_async`, or a
 * command written to the frame-copy helper), so the tracker waits for the
 * snapshot that confirms it. This bound keeps a lost acknowledgement from
 * leaving the row `recording` forever.
 */
const STOP_ACKNOWLEDGEMENT_TIMEOUT_MS = 10_000;

/**
 * How long an observed inactive recording must stay inactive before it is
 * finalized.
 *
 * macOS native-view clears `recordingActive` *before* dispatching the async
 * `stream-record` property set and restores it (with an error) if that
 * request is rejected, so the first inactive snapshot is optimistic rather
 * than an acknowledgement. Three 500 ms poll cycles are enough for that
 * revert to arrive. The frame-copy helper sets the property synchronously and
 * is unaffected; it simply finalizes a beat later.
 */
const STOP_SETTLE_WINDOW_MS = 1_500;

/**
 * How long a synthetic error/closed snapshot defers finalization.
 *
 * `disposeSession()` emits that snapshot immediately, while the frame-copy
 * helper still has a 0.5 s quit grace and a 2 s SIGTERM grace before SIGKILL
 * — statting the file earlier can record a truncated size or mistake a short
 * capture for an empty failure. The row stays `recording` (and therefore
 * repairable by startup recovery) until the window elapses, so an app quit
 * that outruns the timer loses nothing.
 */
const TEARDOWN_FLUSH_WINDOW_MS = 2_500;

/**
 * Deadline for the finalization stat. The recording directory is
 * user-selected and may sit on a network filesystem; an unbounded stat
 * would stall the tracker's serialized queue (blocking new inserts and stop
 * enrichment's `whenSettled`). A timed-out or error-shaped probe reports
 * `unknown` — the recording is then finalized without branding a
 * likely-good file as failed.
 */
const FINALIZE_STAT_TIMEOUT_MS = 3_000;

type FinalizeFileProbe =
    { kind: 'size'; size: number } | { kind: 'missing' } | { kind: 'unknown' };

/**
 * Persists the lifecycle of embedded-MPV live recordings into the
 * `recordings` table.
 *
 * Explicit start/stop hooks are the only place where the start metadata and
 * the reserved target path are visible deterministically, but they are
 * requests, not outcomes: `addon.stopRecording()` merely dispatches, so
 * finalization always waits for the snapshot that reports the recording
 * inactive. That same observer covers the stop paths which never call
 * `stopRecording()` at all (stream-replacement auto-stop, a frame-copy helper
 * crash that leaves `active: true` behind, session error/close). Rows that
 * survive a hard app kill in status 'recording' are repaired by
 * `reconcileStaleRecordings()` at startup.
 */
export class EmbeddedMpvRecordingTracker {
    private readonly open = new Map<string, OpenRecordingEntry>();
    /**
     * Entries whose finalization is queued but whose terminal database
     * update has not committed yet. `finalize()` removes an entry from
     * `open` immediately, so without this ledger `activeRowIds()` would
     * omit a row still persisted as `recording` and startup recovery could
     * repair it mid-finalization.
     */
    private readonly finalizing = new Set<OpenRecordingEntry>();
    /** Serializes DB mutations so a fast stop cannot outrun its insert. */
    private chain: Promise<void> = Promise.resolve();

    onRecordingStarted(event: RecordingStartedEvent): void {
        // A session runs at most one recording, so a new start means any
        // recording still open on this session has stopped. Once the map
        // entry is replaced, snapshots can no longer reach the old entry —
        // make sure one of its own timers finalizes it (after the settle
        // window, so mpv gets to flush the old file first).
        const replaced = this.open.get(event.sessionId);
        if (replaced && !replaced.finalized) {
            if (replaced.settleTimer !== undefined) {
                clearTimeout(replaced.settleTimer);
            }
            replaced.settleTimer = setTimeout(() => {
                this.finalize(
                    replaced,
                    replaced.interrupted ? 'interrupted' : 'completed'
                );
            }, STOP_SETTLE_WINDOW_MS);
        }

        const startedAt = new Date().toISOString();
        const metadata = event.metadata;
        const rowId = this.enqueue(async () => {
            const db = await getDatabase();
            const result = await db.insert(schema.recordings).values({
                sessionId: event.sessionId,
                // Recovery uses this to tell a crashed run's leftovers from a
                // row another live process still owns.
                ownerPid: process.pid,
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
            sessionId: event.sessionId,
            targetPath: event.targetPath,
            startedAt,
            sawActive: false,
            interrupted: false,
            stopRequested: false,
            finalized: false,
            rowId,
        });
        void rowId.then((id) => {
            if (id !== null) {
                broadcastRecordingsUpdate();
            }
        });
    }

    /**
     * Stop requested through the stop IPC/controls. The row is finalized by
     * the acknowledged snapshot, not here: stopping is asynchronous, and
     * statting (or unlinking) the file before mpv flushed it would report a
     * short recording as failed and could delete bytes still being written.
     */
    /**
     * The stream carrying this recording dropped and an automatic reload is
     * about to replace it (see embedded-mpv-reconnect.ts). The file mpv was
     * writing is over: finalize it as `interrupted`. Without this, a clean
     * EOF never reaches the error path above and the reload's own
     * `onRecordingStarted` would file the partial as `completed`.
     */
    onRecordingInterrupted(sessionId: string): void {
        const entry = this.open.get(sessionId);
        if (!entry || entry.finalized) {
            return;
        }
        entry.interrupted = true;
        if (entry.settleTimer !== undefined) {
            clearTimeout(entry.settleTimer);
        }
        entry.settleTimer = setTimeout(() => {
            this.finalize(entry, 'interrupted');
        }, TEARDOWN_FLUSH_WINDOW_MS);
    }

    onRecordingStopped(sessionId: string): void {
        const entry = this.open.get(sessionId);
        if (!entry || entry.stopRequested) {
            return;
        }
        entry.stopRequested = true;
        entry.stopFallbackTimer = setTimeout(() => {
            // mpv never confirmed; finalize anyway so the row cannot stay
            // `recording` for the rest of the session.
            this.finalize(entry, 'completed');
        }, STOP_ACKNOWLEDGEMENT_TIMEOUT_MS);
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
            // Teardown may still be flushing the file (the frame-copy helper
            // exits up to ~2 s after this synthetic snapshot), so finalize
            // after the flush window rather than statting now. An armed
            // settle timer means the stop was already acknowledged before
            // the session went down — leave it to finalize as 'completed'.
            if (entry.settleTimer === undefined) {
                entry.settleTimer = setTimeout(() => {
                    this.finalize(entry, 'interrupted');
                }, TEARDOWN_FLUSH_WINDOW_MS);
            }
            return;
        }

        const recording = session.recording;
        if (!recording) {
            return;
        }

        if (recording.active && recording.targetPath === entry.targetPath) {
            entry.sawActive = true;
            // A rejected stop puts the recording back: abandon the pending
            // finalization instead of ending a row that is still recording.
            // Not after an interruption, though: the engine may still show
            // the old recording as active for a tick after a clean live EOF,
            // and the reload replacing it is already on its way.
            if (entry.settleTimer !== undefined && !entry.interrupted) {
                clearTimeout(entry.settleTimer);
                entry.settleTimer = undefined;
            }
            return;
        }

        if (recording.active) {
            return;
        }

        if (entry.sawActive) {
            // Inactive, but on native-view that state precedes mpv's reply.
            // Finalize only once it survived the settle window.
            if (entry.settleTimer === undefined) {
                entry.settleTimer = setTimeout(() => {
                    this.finalize(
                        entry,
                        entry.interrupted ? 'interrupted' : 'completed'
                    );
                }, STOP_SETTLE_WINDOW_MS);
            }
        } else if (recording.error) {
            // The async start failed before the recording ever activated.
            this.finalize(entry, 'failed', recording.error);
        }
        // else: start still settling — a successful async start passes
        // through active:false snapshots before the property set applies.
    }

    /**
     * Resolves once every mutation enqueued so far has committed.
     *
     * Stop enrichment awaits this so the row's INSERT is guaranteed to exist
     * before it is looked up (a recording stopped within milliseconds of
     * starting). It deliberately involves no deadline: it waits for work, not
     * for a clock, and the enrichment does not care whether the row has
     * reached its terminal status yet.
     */
    whenSettled(): Promise<void> {
        return this.chain;
    }

    /**
     * Row ids of the recordings this process is actively tracking.
     *
     * Startup recovery consults this because the renderer is interactive
     * before the reconciliation pass runs: a recording started in that window
     * carries `ownerPid === process.pid`, which the pid heuristic alone would
     * misread as a recycled-pid leftover from a previous run.
     */
    async activeRowIds(): Promise<Set<number>> {
        // Open recordings AND rows whose finalization has not committed yet
        // — both are still persisted as `recording` and must not be
        // repaired by startup recovery.
        const entries = [...this.open.values(), ...this.finalizing];
        const ids = await Promise.all(entries.map((entry) => entry.rowId));
        return new Set(ids.filter((id): id is number => id !== null));
    }

    private finalize(
        entry: OpenRecordingEntry,
        status: RecordingFinalStatus,
        errorMessage?: string
    ): void {
        if (entry.finalized) {
            return;
        }
        entry.finalized = true;
        // Keep the row visible to activeRowIds() until the terminal update
        // commits — it is still persisted as 'recording' meanwhile.
        this.finalizing.add(entry);
        // The map may already point at a newer recording on the same
        // session (stop → immediate restart); only remove the mapping when
        // it is still this entry's.
        if (this.open.get(entry.sessionId) === entry) {
            this.open.delete(entry.sessionId);
        }
        if (entry.stopFallbackTimer !== undefined) {
            clearTimeout(entry.stopFallbackTimer);
        }
        if (entry.settleTimer !== undefined) {
            clearTimeout(entry.settleTimer);
        }

        void this.enqueue(async () => {
            const rowId = await entry.rowId;
            if (rowId === null) {
                return null;
            }

            const probe = await this.probeFinalFile(entry.targetPath);
            let finalStatus: RecordingFinalStatus = status;
            let fileSize: number | null = null;
            if (probe.kind === 'size' && probe.size > 0) {
                fileSize = probe.size;
            } else if (probe.kind === 'unknown') {
                // The stat timed out or errored (slow or unreachable
                // filesystem): keep the requested status with an unknown
                // size instead of branding a likely-good recording failed.
            } else {
                // Absent or empty — nothing usable reached the disk, so the
                // honest terminal state is 'failed'.
                finalStatus = 'failed';
                if (
                    probe.kind === 'size' &&
                    probe.size === 0 &&
                    !entry.sawActive
                ) {
                    // The empty file is the pre-reserved target of a
                    // recording that never started; a recording that did go
                    // active keeps its file even when it looks empty, since
                    // mpv owns those bytes.
                    this.safeUnlink(entry.targetPath);
                }
            }

            const db = await getDatabase();
            await db
                .update(schema.recordings)
                .set({
                    status: finalStatus,
                    endedAt: new Date().toISOString(),
                    fileSizeBytes: fileSize,
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
            this.finalizing.delete(entry);
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

    private async probeFinalFile(filePath: string): Promise<FinalizeFileProbe> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<FinalizeFileProbe>((resolve) => {
            timeout = setTimeout(
                () => resolve({ kind: 'unknown' }),
                FINALIZE_STAT_TIMEOUT_MS
            );
        });
        const probe = stat(filePath).then(
            (stats): FinalizeFileProbe =>
                stats.isFile()
                    ? { kind: 'size', size: stats.size }
                    : { kind: 'missing' },
            (error): FinalizeFileProbe => {
                const code = (error as NodeJS.ErrnoException)?.code;
                // Only proven absence may fail the row; every other error
                // (permissions, I/O, unreachable mount) stays unknown.
                return code === 'ENOENT' || code === 'ENOTDIR'
                    ? { kind: 'missing' }
                    : { kind: 'unknown' };
            }
        );
        try {
            return await Promise.race([probe, timedOut]);
        } finally {
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }
        }
    }

    private safeUnlink(filePath: string): void {
        // Fire-and-forget: best-effort cleanup of the 0-byte reservation
        // must not stall the serialized queue on a hung filesystem.
        void unlink(filePath).catch(() => undefined);
    }
}

export const embeddedMpvRecordingTracker = new EmbeddedMpvRecordingTracker();
