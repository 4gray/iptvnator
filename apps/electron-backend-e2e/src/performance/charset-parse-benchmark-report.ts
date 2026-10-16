/** Two-byte input slower than this ratio justifies parser changes (plan D1). */
export const CHARSET_SLOWDOWN_THRESHOLD = 1.5;

/**
 * Input variants of the charset benchmark. `latin1-bom` is the `latin1`
 * fixture behind a UTF-8 byte-order mark: same content, but V8 must store
 * the decoded string as two-byte, which isolates the encoding effect from
 * the content effect that Cyrillic titles have on ASCII-only regexes.
 */
export const CHARSET_BENCHMARK_VARIANTS = [
    'latin1',
    'latin1-bom',
    'cyrillic',
] as const;

export type CharsetBenchmarkVariant =
    (typeof CHARSET_BENCHMARK_VARIANTS)[number];

export interface CpuProfileNode {
    readonly id: number;
    readonly callFrame: {
        readonly functionName: string;
        readonly url: string;
        readonly lineNumber: number;
    };
}

export interface CpuProfileLike {
    readonly nodes: readonly CpuProfileNode[];
    readonly samples?: readonly number[];
}

export interface SelfSampleFrame {
    readonly frame: string;
    readonly samples: number;
}

export interface CharsetCaseMeasurement {
    readonly workload: string;
    readonly variant: CharsetBenchmarkVariant;
    readonly inputBytes: number;
    readonly inputLength: number;
    /** True when V8 must store the decoded input as a two-byte string. */
    readonly hasNonLatin1Characters: boolean;
    readonly wallClockMs: readonly number[];
    readonly cpuMs: readonly number[];
    readonly profileSamples: number;
    readonly topSelfFrames: readonly SelfSampleFrame[];
}

export interface CharsetVariantSummary {
    readonly variant: CharsetBenchmarkVariant;
    readonly wallP50Ms: number;
    readonly cpuP50Ms: number;
    readonly profileSamples: number;
    readonly wallRatio: number;
    readonly cpuRatio: number;
    readonly sampleRatio: number;
    /** Slower than the threshold on CPU time and on profile samples. */
    readonly exceedsThreshold: boolean;
}

export interface CharsetComparison {
    readonly workload: string;
    readonly variants: readonly CharsetVariantSummary[];
}

/**
 * Variant order for one benchmark round. The starting variant rotates every
 * round so no input always runs first or last after a garbage collection.
 */
export function variantOrderForRound(round: number): CharsetBenchmarkVariant[] {
    const variants = [...CHARSET_BENCHMARK_VARIANTS];
    const offset = round % variants.length;
    return [...variants.slice(offset), ...variants.slice(0, offset)];
}

export function medianOf(values: readonly number[]): number {
    if (values.length === 0) {
        throw new Error('Cannot take the median of an empty sample');
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Counts self samples per frame; the top frames explain where time went. */
export function summarizeSelfSamples(
    profile: CpuProfileLike,
    limit = 8
): { total: number; top: SelfSampleFrame[] } {
    const nodesById = new Map(profile.nodes.map((node) => [node.id, node]));
    const counts = new Map<string, number>();
    const samples = profile.samples ?? [];

    for (const nodeId of samples) {
        const frame = describeFrame(nodesById.get(nodeId));
        counts.set(frame, (counts.get(frame) ?? 0) + 1);
    }

    return { total: samples.length, top: topFrames(counts, limit) };
}

export function topFrames(
    counts: ReadonlyMap<string, number>,
    limit: number
): SelfSampleFrame[] {
    return [...counts.entries()]
        .map(([frame, samples]) => ({ frame, samples }))
        .sort(
            (left, right) =>
                right.samples - left.samples ||
                left.frame.localeCompare(right.frame)
        )
        .slice(0, limit);
}

export function compareCharsets(
    measurements: readonly CharsetCaseMeasurement[]
): CharsetComparison[] {
    const workloads = [...new Set(measurements.map((m) => m.workload))];

    return workloads.map((workload) => {
        const baseline = findCase(measurements, workload, 'latin1');
        const baselineWall = medianOf(baseline.wallClockMs);
        const baselineCpu = medianOf(baseline.cpuMs);

        return {
            workload,
            variants: CHARSET_BENCHMARK_VARIANTS.map((variant) => {
                const measurement = findCase(measurements, workload, variant);
                const wallP50Ms = medianOf(measurement.wallClockMs);
                const cpuP50Ms = medianOf(measurement.cpuMs);
                const cpuRatio = cpuP50Ms / baselineCpu;
                const sampleRatio =
                    measurement.profileSamples / baseline.profileSamples;
                return {
                    variant,
                    wallP50Ms,
                    cpuP50Ms,
                    profileSamples: measurement.profileSamples,
                    wallRatio: wallP50Ms / baselineWall,
                    cpuRatio,
                    sampleRatio,
                    exceedsThreshold:
                        cpuRatio > CHARSET_SLOWDOWN_THRESHOLD &&
                        sampleRatio > CHARSET_SLOWDOWN_THRESHOLD,
                };
            }),
        };
    });
}

export function formatCharsetReport(
    comparisons: readonly CharsetComparison[]
): string {
    const header =
        '| Workload | Input | Wall P50 ms | CPU P50 ms | Samples | Wall ratio | CPU ratio | Sample ratio | Over 1.5x |';
    const divider =
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |';
    const rows = comparisons.flatMap((comparison) =>
        comparison.variants.map((row) =>
            [
                comparison.workload,
                row.variant,
                row.wallP50Ms.toFixed(1),
                row.cpuP50Ms.toFixed(1),
                String(row.profileSamples),
                `${row.wallRatio.toFixed(2)}x`,
                `${row.cpuRatio.toFixed(2)}x`,
                `${row.sampleRatio.toFixed(2)}x`,
                row.exceedsThreshold ? 'yes' : 'no',
            ].join(' | ')
        )
    );
    return [header, divider, ...rows.map((row) => `| ${row} |`)].join('\n');
}

function findCase(
    measurements: readonly CharsetCaseMeasurement[],
    workload: string,
    variant: CharsetBenchmarkVariant
): CharsetCaseMeasurement {
    const match = measurements.find(
        (m) => m.workload === workload && m.variant === variant
    );
    if (!match) {
        throw new Error(`Missing ${variant} measurement for ${workload}`);
    }
    return match;
}

function describeFrame(node: CpuProfileNode | undefined): string {
    if (!node) {
        return '(unknown)';
    }
    const { functionName, url, lineNumber } = node.callFrame;
    const name = functionName || '(anonymous)';
    if (!url) {
        return name;
    }
    const file = url.slice(url.lastIndexOf('/') + 1);
    return `${name} ${file}:${lineNumber + 1}`;
}
