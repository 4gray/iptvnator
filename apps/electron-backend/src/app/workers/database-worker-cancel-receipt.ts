import { performance } from 'node:perf_hooks';
import type { DbWorkerPerformanceCancelReceivedMessage } from './database-worker.types';
import { WORKER_PROFILING_ENV } from './worker-performance-capture.runtime';

const MAX_IDENTIFIER_LENGTH = 128;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

interface CancelReceiptRuntime {
    readonly readEpochMs: () => number;
}

type CancelReceiptPublisher = (
    message: DbWorkerPerformanceCancelReceivedMessage
) => void;

const DEFAULT_RUNTIME: CancelReceiptRuntime = {
    readEpochMs: () => performance.timeOrigin + performance.now(),
};

export function publishDatabaseWorkerCancelReceipt(
    operationId: unknown,
    requestId: unknown,
    publish: CancelReceiptPublisher,
    runtime: CancelReceiptRuntime = DEFAULT_RUNTIME
): void {
    if (process.env[WORKER_PROFILING_ENV] !== '1') {
        return;
    }
    if (!isSafeIdentifier(operationId) || !isSafeIdentifier(requestId)) {
        return;
    }

    let epochMs: number;
    try {
        epochMs = runtime.readEpochMs();
    } catch {
        return;
    }
    if (!Number.isFinite(epochMs) || epochMs <= 0) {
        return;
    }

    try {
        publish({
            type: 'performance-cancel-received',
            operationId,
            requestId,
            epochMs,
        });
    } catch {
        // Development-only instrumentation must not affect cancellation.
    }
}

function isSafeIdentifier(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= MAX_IDENTIFIER_LENGTH &&
        value === value.trim() &&
        SAFE_IDENTIFIER_PATTERN.test(value)
    );
}
