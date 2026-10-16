/**
 * Scheduling helpers for tools/coverage/run-tier-a-coverage.mjs.
 *
 * Tier A used to run its ~33 projects one after another, each as its own
 * `pnpm nx run <project>:test` process: 23 minutes in CI, most of it Jest and
 * Nx start-up, ts-jest cache warm-up and idle workers on small projects. The
 * runner now keeps a few projects in flight at once and gives each Jest a
 * bounded worker count, so the runner's total CPU budget stays close to the
 * machine's core count instead of multiplying with it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SPEC_FILE = /\.(spec|test)\.ts$/;

function listSpecFiles(directory) {
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries.flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return listSpecFiles(fullPath);
        }
        return entry.isFile() && SPEC_FILE.test(entry.name) ? [fullPath] : [];
    });
}

/** Counts spec files under a directory; used to start the big projects first. */
export function countSpecFiles(directory) {
    return listSpecFiles(directory).length;
}

// `createRequire(__filename)('electron')` resolves the binary path, which
// downloads it on first use (see tools/testing/ensure-electron-binary.mjs).
const ELECTRON_BINARY_REQUIRE = /createRequire\([^)]*\)\(\s*['"]electron['"]\s*\)/;

/** Whether any spec under a directory resolves the Electron binary to exec it. */
export function specsResolveElectronBinary(directory) {
    return listSpecFiles(directory).some((file) =>
        ELECTRON_BINARY_REQUIRE.test(readFileSync(file, 'utf8'))
    );
}

/**
 * Longest-first ordering: with a bounded pool, a big project started last
 * would run alone at the end while the other slots sit idle. Ties keep the
 * policy order so the output stays stable.
 */
export function orderLongestFirst(projects, weightOf) {
    return projects
        .map((project, index) => ({ project, index, weight: weightOf(project) }))
        .sort((a, b) => b.weight - a.weight || a.index - b.index)
        .map((entry) => entry.project);
}

/**
 * How many projects to keep in flight. Defaults to one less than the core
 * count, capped at three: beyond that the per-process start-up cost is paid
 * anyway and the Jest workers of the concurrent runs starve each other.
 *
 * Two cores stay serial on purpose. Two in flight there would leave each
 * project one worker, and Jest then runs in-band: every spec file of a big
 * project (ui-playback, web) shares one heap. On a 2-core / 7 GB box, where
 * Node's default heap is 2 GiB, that heap ran out; with a 4 GiB heap it
 * passed, about 15% faster than serial on a warm cache but with 1.2 GiB more
 * peak memory. CI runs on 4 cores, so the saving would not reach it.
 */
export function resolveConcurrency({ requested, cpuCount }) {
    if (Number.isInteger(requested) && requested > 0) return requested;
    return Math.max(1, Math.min(3, cpuCount - 1));
}

/**
 * Jest workers per project, so that concurrency × workers stays near the core
 * count. Small projects never use them all, which is what leaves room for the
 * other slots. The defaults never go below two on a multi-core machine:
 * `--max-workers=1` runs Jest in-band (see resolveConcurrency).
 */
export function resolveWorkersPerProject({ requested, concurrency, cpuCount }) {
    if (Number.isInteger(requested) && requested > 0) return requested;
    return Math.max(1, Math.ceil(cpuCount / concurrency));
}

/**
 * Runs `tasks` (functions returning a promise of `{ status }`) with at most
 * `concurrency` in flight. Fail-fast: after the first non-zero status no new
 * task starts, but the ones already running are awaited so their output and
 * coverage files are complete. Resolves with every started task's result in
 * start order plus the names that were never started.
 */
export async function runWithConcurrency(tasks, { concurrency, onSettled }) {
    const results = [];
    const skipped = [];
    let nextIndex = 0;
    let failed = false;

    async function worker() {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            const task = tasks[index];
            if (failed) {
                skipped.push(task.name);
                continue;
            }
            const startedAt = Date.now();
            let result;
            try {
                result = await task.run();
            } catch (error) {
                result = { status: 1, error };
            }
            const settled = {
                name: task.name,
                status: result.status,
                error: result.error,
                durationMs: Date.now() - startedAt,
            };
            results[index] = settled;
            if (settled.status !== 0) failed = true;
            onSettled?.(settled);
        }
    }

    const workers = [];
    for (let slot = 0; slot < Math.max(1, concurrency); slot += 1) {
        workers.push(worker());
    }
    await Promise.all(workers);

    return {
        failed,
        results: results.filter(Boolean),
        skipped,
    };
}

export function formatDuration(ms) {
    const seconds = Math.round(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

/**
 * Whole positive integers only: `3oops` and `2.5` are rejected rather than
 * truncated, so a typo cannot silently apply a different resource budget.
 */
function parsePositiveInteger(raw, what) {
    if (!/^\d+$/.test(raw.trim()) || Number.parseInt(raw, 10) < 1) {
        throw new Error(
            `${what} expects a positive integer, received "${raw}".`
        );
    }
    return Number.parseInt(raw, 10);
}

/** Reads a positive integer from the environment; unset or empty means absent. */
export function integerEnv(env, name) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return undefined;
    return parsePositiveInteger(raw, name);
}

/** Parses `--flag=value` style integers; returns undefined when absent. */
export function integerFlag(argv, name) {
    const prefix = `--${name}=`;
    const raw = argv.find((argument) => argument.startsWith(prefix));
    if (raw === undefined) return undefined;
    return parsePositiveInteger(raw.slice(prefix.length), prefix);
}
