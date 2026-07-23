import type {
    DbOperationEvent,
    DbWorkerOperation,
} from '../workers/database-worker.types';

export type PendingDatabaseRequest = {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    onEvent?: (event: DbOperationEvent) => void;
    operation: DbWorkerOperation;
    startedAt: number;
};

export type DatabaseRequestOptions = {
    onEvent?: (event: DbOperationEvent) => void;
};

export function createDatabaseWorkerError(error: {
    message: string;
    name?: string;
    stack?: string;
}): Error {
    const workerError = new Error(error.message);
    workerError.name = error.name || 'DatabaseWorkerError';
    workerError.stack = error.stack || workerError.stack;
    return workerError;
}
