import { getHeapStatistics } from 'node:v8';
import { MessagePort } from 'node:worker_threads';
import { WORKER_PROFILING_ENV } from './worker-performance-capture.runtime';

export const DATABASE_WORKER_POST_GC_HEAP_REQUEST_TYPE =
    'performance:collect-post-gc-heap' as const;
export const DATABASE_WORKER_POST_GC_HEAP_RESULT_TYPE =
    'performance:post-gc-heap-result' as const;

export const DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON = {
    CAPTURE_FAILED: 'capture-failed',
    GC_UNAVAILABLE: 'gc-unavailable',
    PROFILING_DISABLED: 'profiling-disabled',
    WORKER_BUSY: 'worker-busy',
} as const;

export type DatabaseWorkerPostGcHeapUnavailableReason =
    (typeof DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON)[keyof typeof DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON];

export interface DatabaseWorkerPostGcHeapRequest {
    readonly type: typeof DATABASE_WORKER_POST_GC_HEAP_REQUEST_TYPE;
    readonly responsePort: MessagePort;
}

export type DatabaseWorkerPostGcHeapResult =
    | {
          readonly type: typeof DATABASE_WORKER_POST_GC_HEAP_RESULT_TYPE;
          readonly postGcHeapUsedBytes: number;
          readonly unavailableReason: null;
      }
    | {
          readonly type: typeof DATABASE_WORKER_POST_GC_HEAP_RESULT_TYPE;
          readonly postGcHeapUsedBytes: null;
          readonly unavailableReason: DatabaseWorkerPostGcHeapUnavailableReason;
      };

export function isDatabaseWorkerPostGcHeapRequest(
    message: unknown
): message is DatabaseWorkerPostGcHeapRequest {
    if (
        typeof message !== 'object' ||
        message === null ||
        Array.isArray(message)
    ) {
        return false;
    }

    const candidate = message as Record<string, unknown>;
    return (
        candidate['type'] === DATABASE_WORKER_POST_GC_HEAP_REQUEST_TYPE &&
        candidate['responsePort'] instanceof MessagePort
    );
}

function unavailableResult(
    unavailableReason: DatabaseWorkerPostGcHeapUnavailableReason
): DatabaseWorkerPostGcHeapResult {
    return {
        type: DATABASE_WORKER_POST_GC_HEAP_RESULT_TYPE,
        postGcHeapUsedBytes: null,
        unavailableReason,
    };
}

function postResult(
    responsePort: MessagePort,
    result: DatabaseWorkerPostGcHeapResult
): void {
    try {
        responsePort.postMessage(result);
    } catch {
        // Development-only profiling transport must not affect worker behavior.
    } finally {
        try {
            responsePort.close();
        } catch {
            // The one-shot port may already be closed by its peer.
        }
    }
}

export function handleDatabaseWorkerPostGcHeapRequest(
    message: DatabaseWorkerPostGcHeapRequest,
    isIdle: boolean
): void {
    let result: DatabaseWorkerPostGcHeapResult;

    if (process.env[WORKER_PROFILING_ENV] !== '1') {
        result = unavailableResult(
            DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.PROFILING_DISABLED
        );
    } else if (!isIdle) {
        result = unavailableResult(
            DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.WORKER_BUSY
        );
    } else if (typeof globalThis.gc !== 'function') {
        result = unavailableResult(
            DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.GC_UNAVAILABLE
        );
    } else {
        try {
            globalThis.gc();
            const postGcHeapUsedBytes = getHeapStatistics().used_heap_size;

            result =
                Number.isSafeInteger(postGcHeapUsedBytes) &&
                postGcHeapUsedBytes >= 0
                    ? {
                          type: DATABASE_WORKER_POST_GC_HEAP_RESULT_TYPE,
                          postGcHeapUsedBytes,
                          unavailableReason: null,
                      }
                    : unavailableResult(
                          DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.CAPTURE_FAILED
                      );
        } catch {
            result = unavailableResult(
                DATABASE_WORKER_POST_GC_HEAP_UNAVAILABLE_REASON.CAPTURE_FAILED
            );
        }
    }

    postResult(message.responsePort, result);
}
