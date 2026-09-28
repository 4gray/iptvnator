import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Journey summary schema written to
 * `dist/performance/journeys/<timestamp>/summary.json`.
 *
 * `journeys.<id>.counters.<name>` and `journeys.<id>.wallClock.<name>` are
 * plain numbers so the ratchet checker in `tools/performance/` can compare
 * them with the committed baselines. Everything else is evidence.
 */
export const JOURNEY_SUMMARY_SCHEMA_VERSION = 1;

export interface JourneyIterationRecord {
    readonly counters: Readonly<Record<string, number>>;
    readonly evidence: Readonly<Record<string, unknown>>;
    readonly index: number;
    readonly pid: number;
    readonly wallClock: Readonly<Record<string, number>>;
    readonly warmup: boolean;
}

export interface JourneyCounterStability {
    readonly stable: boolean;
    readonly values: readonly number[];
}

export interface JourneySummaryEntry {
    readonly counterStability: Readonly<
        Record<string, JourneyCounterStability>
    >;
    readonly counters: Readonly<Record<string, number>>;
    readonly iterations: readonly JourneyIterationRecord[];
    readonly unavailable: Readonly<Record<string, string>>;
    readonly wallClock: Readonly<Record<string, number>>;
}

export interface JourneySummaryHarness {
    readonly arch: string;
    readonly ci: boolean;
    readonly electron: string;
    readonly electronMain: string;
    readonly measuredIterations: number;
    readonly node: string;
    readonly platform: string;
    readonly rendererIndex: string;
    /** Unique per `perf:journeys` invocation; see `JOURNEY_RUN_ID_ENV`. */
    readonly runId: string;
    readonly warmupIterations: number;
}

export interface JourneySummary {
    readonly generatedAt: string;
    readonly harness: JourneySummaryHarness;
    readonly journeys: Readonly<Record<string, JourneySummaryEntry>>;
    readonly schemaVersion: number;
}

/** Linear-interpolation percentile, the method `performance-statistics.ts` uses. */
export function percentile(values: readonly number[], rank: number): number {
    if (
        values.length === 0 ||
        !Number.isFinite(rank) ||
        rank < 0 ||
        rank > 100
    ) {
        throw new Error('journey-summary-percentile-input');
    }
    const sorted = [...values].sort((left, right) => left - right);
    if (sorted.length === 1) {
        return sorted[0] ?? 0;
    }
    const position = ((sorted.length - 1) * rank) / 100;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sorted[lowerIndex] ?? 0;
    const upper = sorted[upperIndex] ?? lower;
    return lower + (upper - lower) * (position - lowerIndex);
}

function roundTenth(value: number): number {
    return Math.round(value * 10) / 10;
}

function assertSameKeys(
    expected: readonly string[],
    actual: Readonly<Record<string, number>>,
    kind: string,
    index: number
): void {
    const keys = Object.keys(actual).sort();
    if (
        keys.length !== expected.length ||
        keys.some((key, position) => key !== expected[position])
    ) {
        throw new Error(
            `journey-summary-${kind}-set-mismatch-iteration-${index}`
        );
    }
    for (const key of keys) {
        if (!Number.isFinite(actual[key])) {
            throw new Error(`journey-summary-${kind}-not-finite-${key}`);
        }
    }
}

/**
 * Counters are exact: the summary carries the value shared by every measured
 * iteration. When iterations disagree the maximum is reported (a ratchet
 * must never read a value lower than what a run produced) and the
 * disagreement is recorded in `counterStability` so the counter is not
 * promoted to a guardrail until it is deterministic.
 */
export function summarizeJourneyIterations(
    iterations: readonly JourneyIterationRecord[],
    unavailable: Readonly<Record<string, string>>
): JourneySummaryEntry {
    const measured = iterations.filter((iteration) => !iteration.warmup);
    if (measured.length === 0) {
        throw new Error('journey-summary-no-measured-iterations');
    }
    const pids = new Set(iterations.map((iteration) => iteration.pid));
    if (pids.size !== iterations.length) {
        throw new Error('journey-summary-duplicate-pid');
    }
    const first = measured[0] as JourneyIterationRecord;
    const counterNames = Object.keys(first.counters).sort();
    const wallClockNames = Object.keys(first.wallClock).sort();
    for (const iteration of measured) {
        assertSameKeys(
            counterNames,
            iteration.counters,
            'counter',
            iteration.index
        );
        assertSameKeys(
            wallClockNames,
            iteration.wallClock,
            'wall-clock',
            iteration.index
        );
    }
    const counters: Record<string, number> = {};
    const counterStability: Record<string, JourneyCounterStability> = {};
    for (const name of counterNames) {
        const values = measured.map(
            (iteration) => iteration.counters[name] as number
        );
        counters[name] = Math.max(...values);
        counterStability[name] = Object.freeze({
            stable: values.every((value) => value === values[0]),
            values: Object.freeze(values),
        });
    }
    const wallClock: Record<string, number> = {};
    for (const name of wallClockNames) {
        const values = measured.map(
            (iteration) => iteration.wallClock[name] as number
        );
        wallClock[`${name}.p50`] = roundTenth(percentile(values, 50));
        wallClock[`${name}.p90`] = roundTenth(percentile(values, 90));
    }
    return Object.freeze({
        counterStability: Object.freeze(counterStability),
        counters: Object.freeze(counters),
        iterations: Object.freeze([...iterations]),
        unavailable: Object.freeze({ ...unavailable }),
        wallClock: Object.freeze(wallClock),
    });
}

/** `YYYYMMDDTHHMMSSZ`, the timestamp form the other benchmarks use. */
export function formatJourneyOutputTimestamp(date: Date): string {
    if (Number.isNaN(date.getTime())) {
        throw new Error('journey-summary-invalid-date');
    }
    return date
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
}

export function resolveJourneySummaryPath(
    repositoryRoot: string,
    date: Date = new Date()
): string {
    return join(
        repositoryRoot,
        'dist',
        'performance',
        'journeys',
        formatJourneyOutputTimestamp(date),
        'summary.json'
    );
}

/**
 * Environment variable that pins one `perf:journeys` invocation to one
 * summary directory. `playwright.journeys.config.ts` sets it in the runner
 * before the worker starts, so every journey spec of the run writes to the
 * same file.
 */
export const JOURNEY_RUN_STARTED_AT_ENV = 'IPTVNATOR_JOURNEY_RUN_STARTED_AT';
/**
 * Unique id of the invocation, set next to the start time. Two invocations
 * that start in the same second resolve to the same directory; the id keeps
 * one from merging into the other's summary.
 */
export const JOURNEY_RUN_ID_ENV = 'IPTVNATOR_JOURNEY_RUN_ID';

export function resolveJourneyRunSummaryPath(
    repositoryRoot: string,
    environment: NodeJS.ProcessEnv = process.env
): string {
    const raw = environment[JOURNEY_RUN_STARTED_AT_ENV];
    const startedAt = raw ? new Date(raw) : new Date();
    return resolveJourneySummaryPath(repositoryRoot, startedAt);
}

function isFileExistsError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'EEXIST'
    );
}

/**
 * Adds one journey to the run's summary. The first journey creates the
 * file; later journeys merge into it only when they belong to the same run
 * (`harness.runId`) and the rest of the harness is identical. A journey that
 * is already present fails, so no measurement is ever overwritten.
 */
export async function recordJourneySummaryEntry(
    summaryPath: string,
    harness: JourneySummaryHarness,
    journeyId: string,
    entry: JourneySummaryEntry
): Promise<JourneySummary> {
    const created: JourneySummary = {
        generatedAt: new Date().toISOString(),
        harness,
        journeys: { [journeyId]: entry },
        schemaVersion: JOURNEY_SUMMARY_SCHEMA_VERSION,
    };
    try {
        await writeJourneySummary(summaryPath, created);
        return created;
    } catch (error) {
        if (!isFileExistsError(error)) throw error;
    }
    const existing = JSON.parse(
        await readFile(summaryPath, 'utf8')
    ) as JourneySummary;
    if (existing.schemaVersion !== JOURNEY_SUMMARY_SCHEMA_VERSION) {
        throw new Error('journey-summary-merge-schema-mismatch');
    }
    if (existing.harness?.runId !== harness.runId) {
        throw new Error('journey-summary-merge-other-run');
    }
    if (JSON.stringify(existing.harness) !== JSON.stringify(harness)) {
        throw new Error('journey-summary-merge-harness-mismatch');
    }
    if (Object.prototype.hasOwnProperty.call(existing.journeys, journeyId)) {
        throw new Error(`journey-summary-merge-duplicate-${journeyId}`);
    }
    const merged: JourneySummary = {
        ...existing,
        generatedAt: created.generatedAt,
        journeys: { ...existing.journeys, [journeyId]: entry },
    };
    const temporaryPath = `${summaryPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
    });
    await rename(temporaryPath, summaryPath);
    return merged;
}

export async function writeJourneySummary(
    summaryPath: string,
    summary: JourneySummary
): Promise<void> {
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
    });
}
