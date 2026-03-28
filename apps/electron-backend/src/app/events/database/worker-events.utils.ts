import { ipcMain } from 'electron';
import { databaseWorkerClient } from '../../services/database-worker-client';
import type {
    DbOperationEvent,
    DbWorkerOperation,
} from '../../workers/database-worker.types';

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
    return databaseWorkerClient.request<TResult>(channel, payload, {
        onEvent: (workerEvent) => forwardWorkerEvent(event, workerEvent),
    });
}
