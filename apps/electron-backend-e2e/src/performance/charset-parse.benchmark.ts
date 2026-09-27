/**
 * Plan D1: does two-byte (non-Latin-1) input slow down playlist and EPG
 * parsing? Runs each workload on the `latin1` and `cyrillic` synthetic
 * fixtures (identical layout) and on `latin1-bom`, the latin1 bytes behind a
 * UTF-8 byte-order mark, which forces V8's two-byte representation without
 * changing content. Reports P50 wall-clock and process CPU time over the
 * timed iterations, and CPU-profile sample counts from a separate profiled
 * pass (sampled in-process through the inspector, like `node --cpu-prof`).
 *
 *   pnpm nx run electron-backend-e2e:benchmark-charset-parse \
 *       [--iterations=5] [--warmup=1] [--sampling-interval-us=100] \
 *       [--output=/absolute/report.json]
 *
 * To measure with Electron's V8 instead of the Node on PATH, run from
 * apps/electron-backend-e2e:
 *
 *   TSX_TSCONFIG_PATH=tsconfig.json ELECTRON_RUN_AS_NODE=1 \
 *       "$(node -p "require('electron')")" --expose-gc --import tsx \
 *       src/performance/charset-parse.benchmark.ts
 */
import { writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
    CHARSET_BENCHMARK_VARIANTS,
    type CharsetBenchmarkVariant,
    type CharsetCaseMeasurement,
    compareCharsets,
    type CpuProfileLike,
    formatCharsetReport,
    summarizeSelfSamples,
    topFrames,
    variantOrderForRound,
} from './charset-parse-benchmark-report';
import {
    createWorkloads,
    ENTRY_COUNT,
    type Workload,
} from './charset-parse-workloads';

type Variant = CharsetBenchmarkVariant;

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            iterations: { type: 'string', default: '5' },
            warmup: { type: 'string', default: '1' },
            'sampling-interval-us': { type: 'string', default: '100' },
            output: { type: 'string' },
        },
    });
    const iterations = positiveInteger(values.iterations, 'iterations');
    const warmup = nonNegativeInteger(values.warmup, 'warmup');
    const samplingIntervalUs = positiveInteger(
        values['sampling-interval-us'],
        'sampling-interval-us'
    );
    const workloads = await createWorkloads();
    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', {
        interval: samplingIntervalUs,
    });

    const measurements: CharsetCaseMeasurement[] = [];
    for (const workload of workloads) {
        for (const variant of CHARSET_BENCHMARK_VARIANTS) {
            workload.verify(variant);
        }
        const wall = new Map<Variant, number[]>();
        const cpu = new Map<Variant, number[]>();
        const profiles = new Map<Variant, CpuProfileLike[]>();
        // Variants alternate inside every round, starting with a different
        // one each round, so JIT warm-up and heap growth favour no input.
        // Rounds after the timed ones run under the profiler.
        for (let round = 0; round < warmup + iterations * 2; round += 1) {
            for (const variant of variantOrderForRound(round)) {
                const run = workload.prepare(variant);
                collectGarbage();
                const profiled = round >= warmup + iterations;
                if (profiled) {
                    await session.post('Profiler.start');
                }
                const cpuBefore = process.cpuUsage();
                const startedAt = performance.now();
                run();
                const elapsedMs = performance.now() - startedAt;
                const cpuUsed = process.cpuUsage(cpuBefore);
                if (profiled) {
                    const { profile } = await session.post('Profiler.stop');
                    append(profiles, variant, profile);
                } else if (round >= warmup) {
                    append(wall, variant, elapsedMs);
                    append(
                        cpu,
                        variant,
                        (cpuUsed.user + cpuUsed.system) / 1000
                    );
                }
            }
        }
        for (const variant of CHARSET_BENCHMARK_VARIANTS) {
            measurements.push(
                measurementFor(workload, variant, { wall, cpu, profiles })
            );
        }
    }
    session.disconnect();

    const comparisons = compareCharsets(measurements);
    process.stdout.write(
        `Node ${process.version}, ${iterations} iterations after ${warmup} warm-up, ` +
            `${ENTRY_COUNT} entries, sampling every ${samplingIntervalUs} µs\n\n` +
            `${formatCharsetReport(comparisons)}\n\n`
    );
    for (const measurement of measurements) {
        process.stdout.write(
            `${measurement.workload} [${measurement.variant}] non-Latin-1 input: ${
                measurement.hasNonLatin1Characters
            }; top self frames: ${measurement.topSelfFrames
                .slice(0, 5)
                .map((frame) => `${frame.frame} (${frame.samples})`)
                .join(', ')}\n`
        );
    }
    if (values.output) {
        await writeFile(
            resolve(values.output),
            `${JSON.stringify({ node: process.version, iterations, warmup, samplingIntervalUs, comparisons, measurements }, null, 2)}\n`
        );
    }
}

interface CollectedSamples {
    readonly wall: Map<Variant, number[]>;
    readonly cpu: Map<Variant, number[]>;
    readonly profiles: Map<Variant, CpuProfileLike[]>;
}

function measurementFor(
    workload: Workload,
    variant: Variant,
    collected: CollectedSamples
): CharsetCaseMeasurement {
    const input = workload.input(variant);
    const summaries = (collected.profiles.get(variant) ?? []).map((profile) =>
        summarizeSelfSamples(profile, Number.POSITIVE_INFINITY)
    );
    const merged = new Map<string, number>();
    for (const frame of summaries.flatMap((summary) => summary.top)) {
        merged.set(frame.frame, (merged.get(frame.frame) ?? 0) + frame.samples);
    }
    return {
        workload: workload.name,
        variant,
        inputBytes: Buffer.byteLength(input, 'utf8'),
        inputLength: input.length,
        // Latin-1 round-trip is lossless only when every code unit is <= 0xff.
        hasNonLatin1Characters:
            Buffer.from(input, 'latin1').toString('latin1') !== input,
        wallClockMs: collected.wall.get(variant) ?? [],
        cpuMs: collected.cpu.get(variant) ?? [],
        profileSamples: summaries.reduce((sum, s) => sum + s.total, 0),
        topSelfFrames: topFrames(merged, 10),
    };
}

function append<T>(map: Map<Variant, T[]>, variant: Variant, value: T): void {
    map.set(variant, [...(map.get(variant) ?? []), value]);
}

function collectGarbage(): void {
    (globalThis as { gc?: () => void }).gc?.();
}

function positiveInteger(value: string | undefined, name: string): number {
    const parsed = nonNegativeInteger(value, name);
    if (parsed < 1) {
        throw new Error(`--${name} must be a positive integer`);
    }
    return parsed;
}

function nonNegativeInteger(value: string | undefined, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`--${name} must be a non-negative integer`);
    }
    return parsed;
}

main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
});
