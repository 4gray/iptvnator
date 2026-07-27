import type { NumericDistribution } from './m3u-refresh-cancellation-contract';

export function summarizeNumbers(
    values: readonly (number | null | undefined)[]
): NumericDistribution {
    const samples = values
        .filter(
            (value): value is number => value !== null && value !== undefined
        )
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right);

    if (samples.length === 0) {
        return Object.freeze({
            count: 0,
            max: null,
            mean: null,
            median: null,
            min: null,
            p95: null,
            p99: null,
        });
    }

    const total = samples.reduce((sum, value) => sum + value, 0);
    return Object.freeze({
        count: samples.length,
        max: samples.at(-1) ?? null,
        mean: total / samples.length,
        median: percentile(samples, 50),
        min: samples[0] ?? null,
        p95: percentile(samples, 95),
        p99: percentile(samples, 99),
    });
}

export function nonNegativeDifference(
    endEpochMs: number | null | undefined,
    startEpochMs: number | null | undefined
): number | null {
    if (
        endEpochMs === null ||
        endEpochMs === undefined ||
        startEpochMs === null ||
        startEpochMs === undefined
    ) {
        return null;
    }
    const difference = endEpochMs - startEpochMs;
    return Number.isFinite(difference) && difference >= 0 ? difference : null;
}

function percentile(sortedValues: readonly number[], rank: number): number {
    if (sortedValues.length === 1) {
        return sortedValues[0] ?? 0;
    }

    const position = ((sortedValues.length - 1) * rank) / 100;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sortedValues[lowerIndex] ?? 0;
    const upper = sortedValues[upperIndex] ?? lower;
    return lower + (upper - lower) * (position - lowerIndex);
}
