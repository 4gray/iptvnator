import { dialog } from 'electron';
import { initDatabase } from '../database/connection';
import { resetStaleDownloads } from '../events/database/downloads.events';
import { reconcileStaleRecordings } from '../events/database/recording-recovery';
import { traceStartupPhase } from '../services/debug-trace';
import {
    openDatabaseAtStartup,
    reportDatabaseStartupFailure,
} from './database-startup';

/**
 * Database initialization and recovery, after the first renderer load is
 * underway so Linux Electron E2E can observe a BrowserWindow even when
 * SQLite startup or download recovery is slow. IPC handlers call
 * getDatabase() lazily and share the same initialization promise. Never
 * rejects: a database that cannot be opened is retried, then reported to
 * the user (see database-startup.ts for when the recovery passes run).
 */
export async function finishStartupAfterFirstLoad(): Promise<void> {
    await openDatabaseAtStartup({
        initDatabase,
        recoveryPasses: [
            async () => {
                await resetStaleDownloads();
                traceStartupPhase('reset-stale-downloads:done');
            },
            async () => {
                await reconcileStaleRecordings();
                traceStartupPhase('reconcile-stale-recordings:done');
            },
        ],
        reportFailure: (error) =>
            reportDatabaseStartupFailure(error, (options) =>
                dialog.showMessageBox(options)
            ),
        trace: (phase) => traceStartupPhase(phase),
    });
}
