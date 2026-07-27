import type { XtreamBenchmarkManifest } from './xtream-benchmark-contract';
import { assertXtreamArtifactRedacted } from './xtream-diagnostic-artifacts';
import { XTREAM_MEMORY_ACCOUNTING } from './xtream-summary-contract';

export const XTREAM_SHA256 = /^[a-f0-9]{64}$/u;
export const XTREAM_IDENTIFIER =
    /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/iu;

const ROOT_KEYS = [
    'environment',
    'fixture',
    'memoryAccounting',
    'mode',
    'runtime',
    'source',
    'suite',
    'variant',
] as const;
const ENVIRONMENT_KEYS = [
    'cdpAddress',
    'cdpPort',
    'databaseWorkerBatchDelayMs',
    'exposeGc',
    'freshUserDataPerIteration',
    'perfCapture',
    'perfWorkerProfiling',
    'traceRendererConsole',
] as const;
const FIXTURE_KEYS = [
    'bytes',
    'catalogSha256',
    'categories',
    'items',
    'scenario',
    'seed',
] as const;
const RUNTIME_KEYS = [
    'arch',
    'electronVersion',
    'harnessNodeVersion',
    'platform',
] as const;
const SOURCE_KEYS = ['gitCommit', 'gitDiffSha256', 'gitDirty'] as const;
const MEMORY_KEYS = Object.keys(XTREAM_MEMORY_ACCOUNTING);

export function parseXtreamBenchmarkManifest(
    value: unknown
): XtreamBenchmarkManifest {
    try {
        const input = snapshotExactRecord(value, ROOT_KEYS);
        const environment = snapshotExactRecord(
            input['environment'],
            ENVIRONMENT_KEYS
        );
        const fixture = snapshotExactRecord(input['fixture'], FIXTURE_KEYS);
        const memoryAccounting = snapshotExactRecord(
            input['memoryAccounting'],
            MEMORY_KEYS
        );
        const runtime = snapshotExactRecord(input['runtime'], RUNTIME_KEYS);
        const source = snapshotExactRecord(input['source'], SOURCE_KEYS);
        const snapshot = {
            environment: { ...environment },
            fixture: { ...fixture },
            memoryAccounting: { ...memoryAccounting },
            mode: input['mode'],
            runtime: { ...runtime },
            source: { ...source },
            suite: input['suite'],
            variant: input['variant'],
        };
        assertXtreamArtifactRedacted(snapshot);
        if (!isValidManifest(snapshot)) invalid();
        return freezeDeep(snapshot) as unknown as XtreamBenchmarkManifest;
    } catch {
        throw new Error('invalid Xtream benchmark manifest');
    }
}

export function assertXtreamBenchmarkManifest(
    value: unknown
): asserts value is XtreamBenchmarkManifest {
    parseXtreamBenchmarkManifest(value);
}

function isValidManifest(
    manifest: Record<string, unknown> & {
        environment: Record<string, unknown>;
        fixture: Record<string, unknown>;
        memoryAccounting: Record<string, unknown>;
        runtime: Record<string, unknown>;
        source: Record<string, unknown>;
    }
): boolean {
    const { environment, fixture, memoryAccounting, runtime, source } =
        manifest;
    return (
        environment['cdpAddress'] === '127.0.0.1' &&
        isValidXtreamCdpPort(manifest['mode'], environment['cdpPort']) &&
        environment['databaseWorkerBatchDelayMs'] === 0 &&
        environment['exposeGc'] === true &&
        environment['freshUserDataPerIteration'] === true &&
        environment['perfCapture'] === '1' &&
        environment['perfWorkerProfiling'] === '1' &&
        environment['traceRendererConsole'] === '0' &&
        fixture['scenario'] === 'performance-100k' &&
        fixture['seed'] === 91_001 &&
        fixture['categories'] === 100 &&
        fixture['items'] === 100_000 &&
        isPositiveSafeInteger(fixture['bytes']) &&
        typeof fixture['catalogSha256'] === 'string' &&
        XTREAM_SHA256.test(fixture['catalogSha256']) &&
        Object.values(runtime).every(
            (entry) => typeof entry === 'string' && entry.length > 0
        ) &&
        typeof source['gitCommit'] === 'string' &&
        /^[a-f0-9]{40}$/u.test(source['gitCommit']) &&
        typeof source['gitDiffSha256'] === 'string' &&
        XTREAM_SHA256.test(source['gitDiffSha256']) &&
        typeof source['gitDirty'] === 'boolean' &&
        (manifest['mode'] !== 'formal' || !source['gitDirty']) &&
        (manifest['mode'] === 'formal' || manifest['mode'] === 'smoke') &&
        manifest['suite'] === 'xtream-performance-100k' &&
        typeof manifest['variant'] === 'string' &&
        XTREAM_IDENTIFIER.test(manifest['variant']) &&
        MEMORY_KEYS.every(
            (key) =>
                memoryAccounting[key] ===
                XTREAM_MEMORY_ACCOUNTING[
                    key as keyof typeof XTREAM_MEMORY_ACCOUNTING
                ]
        )
    );
}

function isValidXtreamCdpPort(mode: unknown, cdpPort: unknown): boolean {
    return (
        (mode === 'formal' || mode === 'smoke') &&
        typeof cdpPort === 'number' &&
        Number.isInteger(cdpPort) &&
        cdpPort >= 1024 &&
        cdpPort <= 65_535 &&
        (mode === 'smoke' || cdpPort === 9222)
    );
}

function snapshotExactRecord(
    value: unknown,
    expectedKeys: readonly string[]
): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid();
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.length !== expectedKeys.length ||
        keys.some(
            (key) => typeof key !== 'string' || !expectedKeys.includes(key)
        )
    ) {
        invalid();
    }
    return Object.fromEntries(
        expectedKeys.map((key) => [key, Reflect.get(value, key)])
    );
}

function freezeDeep<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.values(value).forEach(freezeDeep);
        Object.freeze(value);
    }
    return value;
}

function isPositiveSafeInteger(value: unknown): boolean {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function invalid(): never {
    throw new Error('invalid manifest');
}
