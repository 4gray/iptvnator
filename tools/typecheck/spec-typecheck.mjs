#!/usr/bin/env node

/**
 * Type-checks every Jest spec program in the workspace.
 *
 * ts-jest runs with `isolatedModules`, so it transpiles each file on its own
 * and never reports type errors: a spec that no longer matches the code it
 * exercises still passes as long as it runs. This gate runs `tsc --noEmit`
 * over every `tsconfig.spec.json` (the same configs Jest hands to ts-jest)
 * with a small concurrency pool and fails when any program reports an error.
 *
 * Usage: node tools/typecheck/spec-typecheck.mjs [--concurrency=N] [filter...]
 * A positional filter keeps only configs whose path contains it. Run
 * `pnpm run typecheck:spec` from the workspace root.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SPEC_TSCONFIG = 'tsconfig.spec.json';
const SEARCH_ROOTS = ['apps', 'libs', 'tools'];
const SKIPPED_DIRECTORIES = new Set([
    'node_modules',
    'dist',
    'coverage',
    'tmp',
    '.nx',
    '.angular',
]);
const TSC_ERROR = /(?:^|\s)error TS\d+:/;

/**
 * Finds every `tsconfig.spec.json` under the search roots, sorted so the
 * output and the pool order stay stable between runs.
 */
export function discoverSpecTsconfigs(workspaceRoot, roots = SEARCH_ROOTS) {
    const found = [];

    function walk(directory) {
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (!SKIPPED_DIRECTORIES.has(entry.name)) {
                    walk(path.join(directory, entry.name));
                }
            } else if (entry.isFile() && entry.name === SPEC_TSCONFIG) {
                found.push(
                    path
                        .relative(
                            workspaceRoot,
                            path.join(directory, entry.name)
                        )
                        .split(path.sep)
                        .join('/')
                );
            }
        }
    }

    for (const root of roots) {
        walk(path.join(workspaceRoot, root));
    }

    return found.sort();
}

/** Keeps the configs whose path contains at least one of the filters. */
export function filterConfigs(configs, filters) {
    if (filters.length === 0) return configs;
    return configs.filter((config) =>
        filters.some((filter) => config.includes(filter))
    );
}

/**
 * Splits `tsc --pretty false` output into error lines and the rest. Continuation
 * lines (indented detail of a multi-line diagnostic) stay with the errors so
 * the printed block is complete, but only lines carrying a TS code count.
 */
export function parseTscOutput(output) {
    const lines = output.split(/\r?\n/);
    const errors = [];
    let errorCount = 0;
    let inError = false;

    for (const line of lines) {
        if (TSC_ERROR.test(line)) {
            errorCount += 1;
            inError = true;
            errors.push(line);
        } else if (inError && /^\s+\S/.test(line)) {
            errors.push(line);
        } else {
            inError = false;
        }
    }

    return { errorCount, errors };
}

/**
 * Concurrency defaults to the core count minus one, capped at four: each tsc
 * process is single-threaded but allocates hundreds of megabytes for the
 * Angular type graph, so more slots mostly trade memory for no wall-clock gain.
 */
export function resolveConcurrency({ requested, cpuCount }) {
    if (Number.isInteger(requested) && requested > 0) return requested;
    return Math.max(1, Math.min(4, cpuCount - 1));
}

/**
 * Runs every task with at most `concurrency` in flight and resolves with all
 * results in task order. Unlike the coverage runner this does not fail fast:
 * a type-check gate is only useful when it reports every failing program.
 */
export async function runAll(tasks, { concurrency, onSettled }) {
    const results = new Array(tasks.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < tasks.length) {
            const index = nextIndex++;
            const task = tasks[index];
            const startedAt = Date.now();
            let outcome;
            try {
                outcome = await task.run();
            } catch (error) {
                outcome = { errorCount: 1, errors: [String(error)], status: 1 };
            }
            const settled = {
                name: task.name,
                ...outcome,
                durationMs: Date.now() - startedAt,
            };
            results[index] = settled;
            onSettled?.(settled);
        }
    }

    const workers = [];
    for (let slot = 0; slot < Math.max(1, concurrency); slot += 1) {
        workers.push(worker());
    }
    await Promise.all(workers);

    return results;
}

export function formatDuration(ms) {
    const seconds = Math.round(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    return minutes > 0
        ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
        : `${seconds}s`;
}

/** Summary table: failing programs first, then the slowest ones. */
export function formatSummary(results, totalMs) {
    const failed = results.filter((result) => result.errorCount > 0);
    const lines = [];
    const sorted = [...results].sort(
        (a, b) =>
            b.errorCount - a.errorCount ||
            b.durationMs - a.durationMs ||
            a.name.localeCompare(b.name)
    );
    const width = Math.max(...results.map((result) => result.name.length), 8);
    lines.push(`${'Program'.padEnd(width)}  Errors  Duration`);
    for (const result of sorted) {
        lines.push(
            `${result.name.padEnd(width)}  ${String(result.errorCount).padStart(6)}  ${formatDuration(result.durationMs)}`
        );
    }
    const totalErrors = failed.reduce(
        (sum, result) => sum + result.errorCount,
        0
    );
    lines.push('');
    lines.push(
        failed.length === 0
            ? `All ${results.length} spec programs type-check (${formatDuration(totalMs)}).`
            : `${failed.length} of ${results.length} spec programs failed with ${totalErrors} error(s) (${formatDuration(totalMs)}).`
    );
    return lines.join('\n');
}

function parsePositiveInteger(raw, what) {
    if (!/^\d+$/.test(raw.trim()) || Number.parseInt(raw, 10) < 1) {
        throw new Error(
            `${what} expects a positive integer, received "${raw}".`
        );
    }
    return Number.parseInt(raw, 10);
}

export function parseArgs(argv, env) {
    let concurrency;
    const filters = [];
    for (const argument of argv) {
        if (argument.startsWith('--concurrency=')) {
            concurrency = parsePositiveInteger(
                argument.slice('--concurrency='.length),
                '--concurrency='
            );
        } else if (argument.startsWith('--')) {
            throw new Error(`Unknown option "${argument}".`);
        } else {
            filters.push(argument);
        }
    }
    const fromEnv = env.SPEC_TYPECHECK_CONCURRENCY;
    if (concurrency === undefined && fromEnv !== undefined && fromEnv !== '') {
        concurrency = parsePositiveInteger(
            fromEnv,
            'SPEC_TYPECHECK_CONCURRENCY'
        );
    }
    return { concurrency, filters };
}

function runTsc(workspaceRoot, config) {
    return new Promise((resolve, reject) => {
        const tscBin = path.join(
            workspaceRoot,
            'node_modules',
            'typescript',
            'bin',
            'tsc'
        );
        const child = spawn(
            process.execPath,
            [tscBin, '-p', config, '--noEmit', '--pretty', 'false'],
            { cwd: workspaceRoot, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let output = '';
        child.stdout.on('data', (chunk) => {
            output += chunk;
        });
        child.stderr.on('data', (chunk) => {
            output += chunk;
        });
        child.once('error', reject);
        child.once('close', (status, signal) => {
            const parsed = parseTscOutput(output);
            if (parsed.errorCount === 0 && (status !== 0 || signal)) {
                parsed.errorCount = 1;
                parsed.errors = [
                    `tsc exited with ${signal ?? `status ${status}`} without reporting a diagnostic:`,
                    output.trim(),
                ];
            }
            resolve({ ...parsed, status: status ?? 1 });
        });
    });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
    const workspaceRoot = process.cwd();
    const { concurrency: requested, filters } = parseArgs(argv, env);
    const configs = filterConfigs(
        discoverSpecTsconfigs(workspaceRoot),
        filters
    );
    if (configs.length === 0) {
        console.error('No tsconfig.spec.json matched.');
        return 1;
    }

    const concurrency = resolveConcurrency({
        requested,
        cpuCount: os.availableParallelism?.() ?? os.cpus().length,
    });
    console.log(
        `Type-checking ${configs.length} spec program(s), ${concurrency} at a time.`
    );

    const startedAt = Date.now();
    const results = await runAll(
        configs.map((config) => ({
            name: config,
            run: () => runTsc(workspaceRoot, config),
        })),
        {
            concurrency,
            onSettled(result) {
                if (result.errorCount === 0) {
                    console.log(
                        `ok   ${result.name} (${formatDuration(result.durationMs)})`
                    );
                    return;
                }
                console.log(
                    `FAIL ${result.name}: ${result.errorCount} error(s) (${formatDuration(result.durationMs)})`
                );
                for (const line of result.errors) {
                    console.log(`     ${line}`);
                }
            },
        }
    );

    console.log('');
    console.log(formatSummary(results, Date.now() - startedAt));
    return results.some((result) => result.errorCount > 0) ? 1 : 0;
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main()
        .then((status) => {
            process.exitCode = status;
        })
        .catch((error) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        });
}
