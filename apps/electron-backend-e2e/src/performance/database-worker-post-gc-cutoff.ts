export type DatabaseWorkerPostGcRequestDisposition =
    'after-cutoff' | 'capture' | 'outside-capture';

export interface DatabaseWorkerPostGcCutoffSnapshot {
    readonly lateRequestCount: number;
    readonly phase: 'active' | 'idle' | 'stopping';
}

export interface DatabaseWorkerPostGcCutoffApi {
    beginCapture(): void;
    beginStop(): void;
    finishStop(): void;
    observeDatabaseRequest(): DatabaseWorkerPostGcRequestDisposition;
    rolloverCapture(): void;
    snapshot(): DatabaseWorkerPostGcCutoffSnapshot;
}

export function createDatabaseWorkerPostGcCutoffApi(): DatabaseWorkerPostGcCutoffApi {
    let lateRequestCount = 0;
    let phase: DatabaseWorkerPostGcCutoffSnapshot['phase'] = 'idle';

    const api: DatabaseWorkerPostGcCutoffApi = {
        beginCapture(): void {
            if (phase !== 'idle') {
                throw new Error(
                    phase === 'stopping'
                        ? 'database-worker-post-gc-stop-in-progress'
                        : 'database-worker-post-gc-capture-already-active'
                );
            }
            lateRequestCount = 0;
            phase = 'active';
        },

        beginStop(): void {
            if (phase !== 'active') {
                throw new Error('database-worker-post-gc-capture-not-active');
            }
            phase = 'stopping';
        },

        finishStop(): void {
            phase = 'idle';
        },

        observeDatabaseRequest(): DatabaseWorkerPostGcRequestDisposition {
            if (phase === 'active') {
                return 'capture';
            }
            if (phase === 'stopping') {
                lateRequestCount += 1;
                return 'after-cutoff';
            }
            return 'outside-capture';
        },

        rolloverCapture(): void {
            if (phase !== 'stopping') {
                throw new Error('database-worker-post-gc-stop-not-in-progress');
            }
            if (lateRequestCount > 0) {
                throw new Error('database-worker-post-gc-capture-contaminated');
            }
            lateRequestCount = 0;
            phase = 'active';
        },

        snapshot(): DatabaseWorkerPostGcCutoffSnapshot {
            return Object.freeze({ lateRequestCount, phase });
        },
    };

    return Object.freeze(api);
}
