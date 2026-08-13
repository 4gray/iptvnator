import { ipcMain } from 'electron';
import { getDatabase } from '../../database/connection';
import { databaseWorkerClient } from '../../services/database-worker-client';
import type {
    DbOperationEvent,
    DbWorkerOperation,
} from '../../workers/database-worker.types';

/**
 * Block until the main process has created and migrated the schema.
 *
 * The renderer is loaded BEFORE `initDatabase()` runs (deliberately — see
 * `main.ts`), and the worker opens the database file directly: it runs no
 * `CREATE TABLE` and no `ALTER TABLE`, and shares no promise with the main
 * process. So without this, a worker query issued during startup can reach
 * an upgraded install whose new columns do not exist yet, and SQLite rejects
 * it with "no such column" — the dashboard then renders an empty activity
 * list until the next reload.
 *
 * This is per-column-addition damage, not specific to any one migration, so
 * the wait belongs at the single choke point every worker request passes
 * through rather than in the queries that happen to read a new column.
 * `getDatabase()` resolves the shared init promise, so this costs one await
 * on the first request and nothing afterwards — the same lazy contract the
 * main-process handlers already rely on.
 */
async function awaitSchemaReady(): Promise<void> {
    await getDatabase();
}

export function forwardWorkerEvent(
    event: Electron.IpcMainInvokeEvent,
    workerEvent: DbOperationEvent
): void {
    if (event.sender.isDestroyed()) {
        return;
    }

    event.sender.send('DB_OPERATION_EVENT', workerEvent);
}

export function handleWorkerRequest<TArgs extends unknown[]>(
    channel: DbWorkerOperation,
    buildPayload: (...args: TArgs) => unknown
): void {
    ipcMain.handle(channel, async (_event, ...args: TArgs) => {
        try {
            await awaitSchemaReady();
            return await databaseWorkerClient.request(
                channel,
                buildPayload(...args)
            );
        } catch (error) {
            console.error(`Error handling ${channel}:`, error);
            throw error;
        }
    });
}

export async function requestWorkerWithEvents<TResult, TPayload>(
    event: Electron.IpcMainInvokeEvent,
    channel: DbWorkerOperation,
    payload: TPayload
): Promise<TResult> {
    await awaitSchemaReady();
    return databaseWorkerClient.request<TResult>(channel, payload, {
        onEvent: (workerEvent) => forwardWorkerEvent(event, workerEvent),
    });
}
