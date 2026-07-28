export interface WorkerSampleDeadlineIdentity {
    readonly captureGeneration: number;
    readonly recordGeneration: number | null;
    readonly sampleKey: object;
}

export type WorkerSampleDeadlineOutcome =
    | { readonly status: 'completed' }
    | { readonly error: unknown; readonly status: 'failed' }
    | { readonly status: 'stale' }
    | { readonly status: 'timed-out' };

export interface WorkerSampleDeadlineInput<T> {
    readonly apply: (value: T) => void;
    readonly capturedGeneration: number | null;
    readonly currentIdentity: () => WorkerSampleDeadlineIdentity;
    readonly onTimeout: () => void;
    readonly operation: () => Promise<T>;
    readonly sampleKey: object;
    readonly timers?: WorkerSampleDeadlineTimers;
    readonly timeoutMs: number;
}

export interface WorkerSampleDeadlineTimers {
    clearTimeout(handle: unknown): void;
    setTimeout(callback: () => void, timeoutMs: number): unknown;
}

export interface WorkerSampleDeadlineApi {
    run<T>(
        input: WorkerSampleDeadlineInput<T>
    ): Promise<WorkerSampleDeadlineOutcome>;
}

export function assertWorkerSampleCaptureValid(
    invalidReasons: readonly string[]
): void {
    if (invalidReasons.includes('worker-sample-timeout')) {
        throw new Error('main-capture-worker-sample-timeout');
    }
}

export function createWorkerSampleDeadlineApi(): WorkerSampleDeadlineApi {
    const defaultTimers: WorkerSampleDeadlineTimers = {
        clearTimeout(handle: unknown): void {
            globalThis.clearTimeout(
                handle as ReturnType<typeof globalThis.setTimeout>
            );
        },
        setTimeout(callback: () => void, timeoutMs: number): unknown {
            return globalThis.setTimeout(callback, timeoutMs);
        },
    };

    const helpers = {
        isCurrent<T>(input: WorkerSampleDeadlineInput<T>): boolean {
            try {
                const current = input.currentIdentity();
                return (
                    Number.isSafeInteger(input.capturedGeneration) &&
                    Number(input.capturedGeneration) > 0 &&
                    current.captureGeneration === input.capturedGeneration &&
                    current.recordGeneration === input.capturedGeneration &&
                    current.sampleKey === input.sampleKey
                );
            } catch {
                return false;
            }
        },

        run<T>(
            input: WorkerSampleDeadlineInput<T>
        ): Promise<WorkerSampleDeadlineOutcome> {
            if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
                return Promise.resolve({
                    error: new RangeError(
                        'worker sample deadline must be a positive finite number'
                    ),
                    status: 'failed',
                });
            }

            const timers = input.timers ?? defaultTimers;
            return new Promise<WorkerSampleDeadlineOutcome>(
                (resolvePromise) => {
                    let settled = false;
                    let timeoutHandle: unknown;
                    let timeoutScheduled = false;
                    const callbacks = {
                        complete(outcome: WorkerSampleDeadlineOutcome): void {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            if (timeoutScheduled) {
                                try {
                                    timers.clearTimeout(timeoutHandle);
                                } catch {
                                    // Best-effort cleanup must not hide evidence.
                                }
                            }
                            resolvePromise(outcome);
                        },

                        onError(error: unknown): void {
                            if (settled) {
                                return;
                            }
                            callbacks.complete(
                                helpers.isCurrent(input)
                                    ? { error, status: 'failed' }
                                    : { status: 'stale' }
                            );
                        },

                        onTimeout(): void {
                            if (settled) {
                                return;
                            }
                            if (!helpers.isCurrent(input)) {
                                callbacks.complete({ status: 'stale' });
                                return;
                            }
                            try {
                                input.onTimeout();
                                callbacks.complete({ status: 'timed-out' });
                            } catch (error: unknown) {
                                callbacks.complete({
                                    error,
                                    status: 'failed',
                                });
                            }
                        },

                        onValue(value: T): void {
                            if (settled) {
                                return;
                            }
                            if (!helpers.isCurrent(input)) {
                                callbacks.complete({ status: 'stale' });
                                return;
                            }
                            try {
                                input.apply(value);
                                callbacks.complete({ status: 'completed' });
                            } catch (error: unknown) {
                                callbacks.complete({
                                    error,
                                    status: 'failed',
                                });
                            }
                        },
                    };

                    try {
                        timeoutHandle = timers.setTimeout(
                            callbacks.onTimeout,
                            input.timeoutMs
                        );
                        timeoutScheduled = true;
                    } catch (error: unknown) {
                        callbacks.complete({ error, status: 'failed' });
                        return;
                    }

                    void Promise.resolve()
                        .then(input.operation)
                        .then(callbacks.onValue, callbacks.onError);
                }
            );
        },
    };

    return Object.freeze({ run: helpers.run });
}
