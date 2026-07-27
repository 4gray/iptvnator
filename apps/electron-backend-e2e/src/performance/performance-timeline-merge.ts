export interface PerformanceTimelineRecord {
    readonly epochMs: number;
}

export interface PerformanceTimelineMergeApi {
    merge<T extends PerformanceTimelineRecord>(
        baseline: readonly T[],
        additions: readonly T[]
    ): T[];
}

export function createPerformanceTimelineMergeApi(): PerformanceTimelineMergeApi {
    const helpers = {
        compare(
            left: {
                readonly index: number;
                readonly record: PerformanceTimelineRecord;
            },
            right: {
                readonly index: number;
                readonly record: PerformanceTimelineRecord;
            }
        ): number {
            return (
                left.record.epochMs - right.record.epochMs ||
                left.index - right.index
            );
        },
    };
    const api: PerformanceTimelineMergeApi = {
        merge<T extends PerformanceTimelineRecord>(
            baseline: readonly T[],
            additions: readonly T[]
        ): T[] {
            const indexed: Array<{ index: number; record: T }> = [];
            for (let index = 0; index < additions.length; index += 1) {
                indexed.push({ index, record: additions[index] as T });
            }
            indexed.sort(helpers.compare);

            const merged: T[] = [];
            let additionIndex = 0;
            for (const record of baseline) {
                while (
                    additionIndex < indexed.length &&
                    (indexed[additionIndex]?.record.epochMs ??
                        Number.POSITIVE_INFINITY) < record.epochMs
                ) {
                    merged.push(indexed[additionIndex]?.record as T);
                    additionIndex += 1;
                }
                merged.push(record);
            }
            while (additionIndex < indexed.length) {
                merged.push(indexed[additionIndex]?.record as T);
                additionIndex += 1;
            }
            return merged;
        },
    };
    return Object.freeze(api);
}
