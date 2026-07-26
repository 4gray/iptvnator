export type DatabaseWorkerPostGcProbeUnavailableReason =
    | 'capture-failed'
    | 'gc-unavailable'
    | 'post-gc-probe-invalid-response'
    | 'post-gc-probe-message-error'
    | 'post-gc-probe-port-closed'
    | 'post-gc-probe-post-failed'
    | 'post-gc-probe-timeout'
    | 'profiling-disabled'
    | 'worker-busy';

export type DatabaseWorkerPostGcProbeResult =
    | {
          readonly postGcHeapUsedBytes: number;
          readonly unavailableReason: null;
      }
    | {
          readonly postGcHeapUsedBytes: null;
          readonly unavailableReason: DatabaseWorkerPostGcProbeUnavailableReason;
      };

export interface DatabaseWorkerPostGcProbePort {
    close(): void;
    off(event: 'close', listener: () => void): unknown;
    off(event: 'message', listener: (message: unknown) => void): unknown;
    off(event: 'messageerror', listener: (error: unknown) => void): unknown;
    on(event: 'close', listener: () => void): unknown;
    on(event: 'message', listener: (message: unknown) => void): unknown;
    on(event: 'messageerror', listener: (error: unknown) => void): unknown;
    start(): void;
}

export interface DatabaseWorkerPostGcProbeWorker {
    postMessage(message: unknown, transferList: readonly unknown[]): void;
}

export interface DatabaseWorkerPostGcProbeTimers {
    clearTimeout(handle: unknown): void;
    setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface DatabaseWorkerPostGcProbeInput {
    readonly createMessageChannel: () => {
        readonly port1: DatabaseWorkerPostGcProbePort;
        readonly port2: DatabaseWorkerPostGcProbePort;
    };
    readonly timeoutMs?: number;
    readonly timers?: DatabaseWorkerPostGcProbeTimers;
    readonly worker: DatabaseWorkerPostGcProbeWorker;
}

export interface DatabaseWorkerPostGcProbeApi {
    probe(
        input: DatabaseWorkerPostGcProbeInput
    ): Promise<DatabaseWorkerPostGcProbeResult>;
}

export function createDatabaseWorkerPostGcProbeApi(): DatabaseWorkerPostGcProbeApi {
    type JsonRecord = Record<string, unknown>;

    const DEFAULT_TIMEOUT_MS = 5_000;
    const REQUEST_TYPE = 'performance:collect-post-gc-heap';
    const RESULT_TYPE = 'performance:post-gc-heap-result';
    const workerUnavailableReasons = new Set([
        'capture-failed',
        'gc-unavailable',
        'profiling-disabled',
        'worker-busy',
    ]);
    const defaultTimers: DatabaseWorkerPostGcProbeTimers = {
        clearTimeout(handle: unknown): void {
            globalThis.clearTimeout(
                handle as ReturnType<typeof globalThis.setTimeout>
            );
        },
        setTimeout(callback: () => void, delayMs: number): unknown {
            return globalThis.setTimeout(callback, delayMs);
        },
    };

    const helpers = {
        unavailable(
            unavailableReason: DatabaseWorkerPostGcProbeUnavailableReason
        ): DatabaseWorkerPostGcProbeResult {
            return Object.freeze({
                postGcHeapUsedBytes: null,
                unavailableReason,
            });
        },

        normalizeResponse(response: unknown): DatabaseWorkerPostGcProbeResult {
            if (
                typeof response !== 'object' ||
                response === null ||
                Array.isArray(response)
            ) {
                return helpers.unavailable('post-gc-probe-invalid-response');
            }

            const candidate = response as JsonRecord;
            const postGcHeapUsedBytes = candidate['postGcHeapUsedBytes'];
            const unavailableReason = candidate['unavailableReason'];
            if (
                candidate['type'] === RESULT_TYPE &&
                Number.isSafeInteger(postGcHeapUsedBytes) &&
                Number(postGcHeapUsedBytes) >= 0 &&
                unavailableReason === null
            ) {
                return Object.freeze({
                    postGcHeapUsedBytes: Number(postGcHeapUsedBytes),
                    unavailableReason: null,
                });
            }
            if (
                candidate['type'] === RESULT_TYPE &&
                postGcHeapUsedBytes === null &&
                typeof unavailableReason === 'string' &&
                workerUnavailableReasons.has(unavailableReason)
            ) {
                return helpers.unavailable(
                    unavailableReason as DatabaseWorkerPostGcProbeUnavailableReason
                );
            }
            return helpers.unavailable('post-gc-probe-invalid-response');
        },

        probe(
            input: DatabaseWorkerPostGcProbeInput
        ): Promise<DatabaseWorkerPostGcProbeResult> {
            let channel: ReturnType<typeof input.createMessageChannel>;
            try {
                channel = input.createMessageChannel();
            } catch {
                return Promise.resolve(
                    helpers.unavailable('post-gc-probe-post-failed')
                );
            }

            const { port1, port2 } = channel;
            const timers = input.timers ?? defaultTimers;
            const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

            return new Promise((resolve) => {
                let settled = false;
                let timerHandle: unknown;
                let timerScheduled = false;
                const callbacks = {
                    cleanup(): void {
                        try {
                            port1.off('message', callbacks.onMessage);
                        } catch {
                            // Best-effort profiling cleanup must not escape.
                        }
                        try {
                            port1.off('messageerror', callbacks.onMessageError);
                        } catch {
                            // Best-effort profiling cleanup must not escape.
                        }
                        try {
                            port1.off('close', callbacks.onClose);
                        } catch {
                            // Best-effort profiling cleanup must not escape.
                        }
                        if (timerScheduled) {
                            try {
                                timers.clearTimeout(timerHandle);
                            } catch {
                                // Best-effort profiling cleanup must not escape.
                            }
                        }
                        try {
                            port1.close();
                        } catch {
                            // The one-shot response port may already be closed.
                        }
                    },

                    settle(result: DatabaseWorkerPostGcProbeResult): void {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        callbacks.cleanup();
                        resolve(result);
                    },

                    onClose(): void {
                        callbacks.settle(
                            helpers.unavailable('post-gc-probe-port-closed')
                        );
                    },

                    onMessage(message: unknown): void {
                        callbacks.settle(helpers.normalizeResponse(message));
                    },

                    onMessageError(): void {
                        callbacks.settle(
                            helpers.unavailable('post-gc-probe-message-error')
                        );
                    },

                    onTimeout(): void {
                        callbacks.settle(
                            helpers.unavailable('post-gc-probe-timeout')
                        );
                    },
                };

                try {
                    port1.on('message', callbacks.onMessage);
                    port1.on('messageerror', callbacks.onMessageError);
                    port1.on('close', callbacks.onClose);
                    port1.start();
                    timerHandle = timers.setTimeout(
                        callbacks.onTimeout,
                        timeoutMs
                    );
                    timerScheduled = true;
                    input.worker.postMessage(
                        {
                            type: REQUEST_TYPE,
                            responsePort: port2,
                        },
                        [port2]
                    );
                } catch {
                    callbacks.settle(
                        helpers.unavailable('post-gc-probe-post-failed')
                    );
                    try {
                        port2.close();
                    } catch {
                        // A synchronous transfer failure may already close it.
                    }
                }
            });
        },
    };

    return Object.freeze({ probe: helpers.probe });
}
