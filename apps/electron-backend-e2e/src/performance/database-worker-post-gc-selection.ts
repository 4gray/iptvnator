export type DatabaseWorkerPostGcUnavailableReason =
    | 'database-worker-missing'
    | 'database-worker-not-idle'
    | 'multiple-database-workers';

export interface DatabaseWorkerPostGcSelectionRecord {
    readonly captureGeneration: number | null;
    readonly kind: string;
    readonly ordinal: number;
    readonly pendingCount: number;
}

export interface DatabaseWorkerPostGcSelection<T> {
    readonly selected: T | null;
    readonly unavailableReason: DatabaseWorkerPostGcUnavailableReason | null;
}

export interface DatabaseWorkerPostGcSelectionApi {
    select<T extends DatabaseWorkerPostGcSelectionRecord>(
        records: readonly T[],
        activeGeneration: number
    ): DatabaseWorkerPostGcSelection<T>;
}

export function createDatabaseWorkerPostGcSelectionApi(): DatabaseWorkerPostGcSelectionApi {
    const helpers = {
        select<T extends DatabaseWorkerPostGcSelectionRecord>(
            records: readonly T[],
            activeGeneration: number
        ): DatabaseWorkerPostGcSelection<T> {
            const currentDatabaseWorkers: T[] = [];
            for (const record of records) {
                if (
                    record.captureGeneration === activeGeneration &&
                    record.kind === 'database.worker'
                ) {
                    currentDatabaseWorkers.push(record);
                }
            }

            if (currentDatabaseWorkers.length === 0) {
                return Object.freeze({
                    selected: null,
                    unavailableReason: 'database-worker-missing',
                });
            }
            if (currentDatabaseWorkers.length > 1) {
                return Object.freeze({
                    selected: null,
                    unavailableReason: 'multiple-database-workers',
                });
            }

            const selected = currentDatabaseWorkers[0] as T;
            if (selected.pendingCount > 0) {
                return Object.freeze({
                    selected: null,
                    unavailableReason: 'database-worker-not-idle',
                });
            }

            return Object.freeze({
                selected,
                unavailableReason: null,
            });
        },
    };

    return Object.freeze({ select: helpers.select });
}
