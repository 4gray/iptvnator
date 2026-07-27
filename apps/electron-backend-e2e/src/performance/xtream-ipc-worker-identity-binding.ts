import type { WorkerRequestPerformanceMetrics } from './m3u-refresh-cancellation-contract';
import type { XtreamIpcAttributionSpan } from './xtream-phase-attribution';
import {
    xtreamIpcProducerIdentityKey,
    xtreamIpcProducerNamespaceForMethod,
    xtreamIpcProducerNamespaceForWorkerOperation,
} from './xtream-ipc-producer-identity';

const DB_METHOD_OPERATION = Object.freeze({
    dbDeletePlaylist: 'DB_DELETE_PLAYLIST',
    dbDeleteXtreamContent: 'DB_DELETE_XTREAM_CONTENT',
    dbGetAppPlaylist: 'DB_GET_APP_PLAYLIST',
    dbGetCategories: 'DB_GET_CATEGORIES',
    dbGetContent: 'DB_GET_CONTENT',
    dbRestoreXtreamUserData: 'DB_RESTORE_XTREAM_USER_DATA',
    dbSaveCategories: 'DB_SAVE_CATEGORIES',
    dbSaveContent: 'DB_SAVE_CONTENT',
    dbUpsertAppPlaylist: 'DB_UPSERT_APP_PLAYLIST',
});
const WORKER_OPERATIONS = new Set<string>(Object.values(DB_METHOD_OPERATION));

export function xtreamWorkerOperationForIpcMethod(
    method: string
): string | null {
    return (
        DB_METHOD_OPERATION[method as keyof typeof DB_METHOD_OPERATION] ?? null
    );
}

export function assertXtreamIpcWorkerIdentityBinding(
    spans: readonly XtreamIpcAttributionSpan[],
    requests: readonly WorkerRequestPerformanceMetrics[]
): void {
    const workerByIdentity = new Map<string, WorkerRequestPerformanceMetrics>();
    for (const request of requests) {
        if (request.ipcCallId === null) continue;
        const namespace = xtreamIpcProducerNamespaceForWorkerOperation(
            typeof request.operation === 'string' ? request.operation : ''
        );
        if (namespace === null) invalid();
        const key = xtreamIpcProducerIdentityKey(namespace, request.ipcCallId);
        if (workerByIdentity.has(key)) invalid();
        workerByIdentity.set(key, request);
    }
    const boundWorkerIdentities = new Set<string>();
    for (const span of spans) {
        if (span.boundary !== 'request') continue;
        const operation = xtreamWorkerOperationForIpcMethod(span.method);
        if (operation === null) continue;
        const namespace = xtreamIpcProducerNamespaceForMethod(span.method);
        if (namespace === null) invalid();
        const key = xtreamIpcProducerIdentityKey(namespace, span.ipcCallId);
        const worker = workerByIdentity.get(key);
        if (
            !worker ||
            worker.operation !== operation ||
            worker.sourceEpochMs !== span.sourceEpochMs
        ) {
            invalid();
        }
        boundWorkerIdentities.add(key);
    }
    if (
        boundWorkerIdentities.size !== workerByIdentity.size ||
        [...workerByIdentity].some(
            ([key, request]) =>
                !boundWorkerIdentities.has(key) ||
                typeof request.operation !== 'string' ||
                !WORKER_OPERATIONS.has(request.operation)
        )
    ) {
        invalid();
    }
}

function invalid(): never {
    throw new Error('invalid Xtream IPC worker identity binding');
}
