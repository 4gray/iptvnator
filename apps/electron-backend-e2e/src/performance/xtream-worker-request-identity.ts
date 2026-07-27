import { isPositiveSafeInteger } from './xtream-exact-schema';

export const XTREAM_WORKER_REQUEST_IDENTITY_KIND = {
    LEGACY_PRELOAD: 'legacy-preload',
    NOT_APPLICABLE: 'not-applicable',
    PRODUCER_IPC: 'producer-ipc',
    PRODUCER_OPERATION: 'producer-operation',
} as const;

export type XtreamWorkerRequestIdentityKind =
    (typeof XTREAM_WORKER_REQUEST_IDENTITY_KIND)[keyof typeof XTREAM_WORKER_REQUEST_IDENTITY_KIND];

const PRODUCER_OPERATION_ID_OPERATIONS = new Set([
    'DB_DELETE_PLAYLIST',
    'DB_DELETE_XTREAM_CONTENT',
    'DB_RESTORE_XTREAM_USER_DATA',
    'DB_SAVE_CONTENT',
]);
const PRODUCER_IPC_OPERATIONS = new Set([
    'DB_GET_CATEGORIES',
    'DB_GET_CONTENT',
    'DB_GLOBAL_SEARCH',
    'DB_SAVE_CATEGORIES',
    'DB_SEARCH_CONTENT',
]);
const LEGACY_PRELOAD_OPERATIONS = new Set([
    'DB_GET_APP_PLAYLIST',
    'DB_UPSERT_APP_PLAYLIST',
]);

export function xtreamWorkerRequestIdentityKind(
    operation: string
): XtreamWorkerRequestIdentityKind {
    if (PRODUCER_OPERATION_ID_OPERATIONS.has(operation)) {
        return XTREAM_WORKER_REQUEST_IDENTITY_KIND.PRODUCER_OPERATION;
    }
    if (PRODUCER_IPC_OPERATIONS.has(operation)) {
        return XTREAM_WORKER_REQUEST_IDENTITY_KIND.PRODUCER_IPC;
    }
    if (LEGACY_PRELOAD_OPERATIONS.has(operation)) {
        return XTREAM_WORKER_REQUEST_IDENTITY_KIND.LEGACY_PRELOAD;
    }
    return XTREAM_WORKER_REQUEST_IDENTITY_KIND.NOT_APPLICABLE;
}

export function validXtreamWorkerRequestIdentity(
    value: Record<string, unknown>
): boolean {
    const operation = value['operation'];
    if (typeof operation !== 'string') return false;
    const kind = xtreamWorkerRequestIdentityKind(operation);
    if (kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.NOT_APPLICABLE) {
        return (
            value['ipcCallId'] === null &&
            value['sourceEpochMs'] === null &&
            value['operationId'] === null &&
            value['operationIdUnavailableReason'] ===
                'preload-performance-marker-not-applicable'
        );
    }
    if (!hasOrderedIpcIdentity(value)) return false;
    if (kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.PRODUCER_OPERATION) {
        if (operation === 'DB_DELETE_PLAYLIST') {
            // The explicit Xtream delete has an operation ID, while the NgRx
            // persistence follow-up is a real correlated preload call without
            // one. Request evidence binds each shape to its exact row counts.
            return (
                value['operationIdUnavailableReason'] === null &&
                (nonEmptyString(value['operationId']) ||
                    value['operationId'] === null)
            );
        }
        return (
            nonEmptyString(value['operationId']) &&
            value['operationIdUnavailableReason'] === null
        );
    }
    if (kind === XTREAM_WORKER_REQUEST_IDENTITY_KIND.PRODUCER_IPC) {
        return (
            value['operationId'] === null &&
            value['operationIdUnavailableReason'] === null
        );
    }
    return nonEmptyString(value['operationId'])
        ? value['operationIdUnavailableReason'] === null
        : value['operationId'] === null &&
              value['operationIdUnavailableReason'] ===
                  'preload-performance-marker-uncorrelated';
}

function hasOrderedIpcIdentity(value: Record<string, unknown>): boolean {
    const sourceEpochMs = value['sourceEpochMs'];
    const requestReceivedEpochMs = value['requestReceivedEpochMs'];
    const responseEpochMs = value['responseEpochMs'];
    return (
        isPositiveSafeInteger(value['ipcCallId']) &&
        isFinitePositive(sourceEpochMs) &&
        isFiniteNonNegative(requestReceivedEpochMs) &&
        isFiniteNonNegative(responseEpochMs) &&
        sourceEpochMs <= requestReceivedEpochMs &&
        requestReceivedEpochMs <= responseEpochMs
    );
}

function isFinitePositive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
