/**
 * Lowers the baselines in tools/performance/journey-baselines.json that every
 * measured run beat. The weekly .github/workflows/performance-ratchet.yml job
 * measures `master` three times on separate runners and runs this script on
 * the summaries; the contract is the Ratchet section of
 * docs/architecture/performance-journeys.md.
 *
 * Rules:
 * - At least three runs. A run is one summary file, or several (the initial
 *   bytes summary and the journeys summary of the same runner) merged.
 * - An entry is tightened only when every run measured it and every
 *   measurement is strictly below `value`. The new value is the largest
 *   measurement: for a counter the largest count, for a wall-clock entry (one
 *   with `toleranceRatio`) the largest per-run summary value, which for a
 *   `.p50` entry is the largest P50.
 * - A counter marked `counterStability.<name>.stable === false` in any run is
 *   skipped: its summary value hides iterations that disagreed.
 * - `value` never goes up, `slack` and `toleranceRatio` never change, and no
 *   entry is added or removed; check-baseline-direction.mjs must accept the
 *   result without --allow-increase, and this script checks that itself.
 * - A tightened entry gets `updatedAt`, `measuredWith` and `evidenceRun` (the
 *   workflow run URL). `evidencePr` is left alone; once the PR exists,
 *   `--fill-evidence-pr` sets it on the entries carrying that run URL.
 *
 * Usage:
 *   node tools/performance/tighten-baselines.mjs \
 *       --run <summary.json|run-dir> --run … --run … \
 *       --evidence-run <workflow run URL> \
 *       [--baselines tools/performance/journey-baselines.json] \
 *       [--report <report.md>] [--measured-with <text>] [--date YYYY-MM-DD]
 *   node tools/performance/tighten-baselines.mjs \
 *       --fill-evidence-pr <number> --evidence-run <workflow run URL> \
 *       [--baselines tools/performance/journey-baselines.json]
 *
 * A run directory contributes every `*.json` file directly inside it.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareBaselineDirection } from './check-baseline-direction.mjs';
import {
    DEFAULT_BASELINES_PATH,
    validateBaselines,
} from './check-journey-ratchet.mjs';

export const MIN_RUNS = 3;
export const DEFAULT_MEASURED_WITH =
    '.github/workflows/performance-ratchet.yml';

const SECTIONS = ['counters', 'wallClock', 'counterStability'];

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatNumber(value) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Merges the summaries of one run into one `journeys` map. The same
 * measurement in two files of one run is ambiguous and therefore an error.
 */
export function mergeRunSummaries(summaries, runLabel = 'run') {
    const journeys = {};
    for (const summary of summaries) {
        if (!isPlainObject(summary?.journeys)) {
            throw new Error(`${runLabel}: a summary has no "journeys" map.`);
        }
        for (const [journey, measured] of Object.entries(summary.journeys)) {
            const target = (journeys[journey] ??= {
                counters: {},
                wallClock: {},
                counterStability: {},
            });
            for (const section of SECTIONS) {
                for (const [name, value] of Object.entries(
                    measured?.[section] ?? {}
                )) {
                    if (Object.hasOwn(target[section], name)) {
                        throw new Error(
                            `${runLabel}: journeys.${journey}.${section}.${name} appears in two summaries of the same run.`
                        );
                    }
                    target[section][name] = value;
                }
            }
        }
    }
    return { journeys };
}

function decide(entry, name, journey, runs) {
    const counter = entry.toleranceRatio === undefined;
    const section = counter ? 'counters' : 'wallClock';
    const measured = runs.map(
        (run) => run.journeys[journey]?.[section]?.[name]
    );
    for (const [index, value] of measured.entries()) {
        if (value === undefined) {
            return {
                measured,
                reason: `not measured in run ${index + 1} (journeys.${journey}.${section}).`,
            };
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return {
                measured,
                reason: `run ${index + 1} measured ${JSON.stringify(value)}, not a finite number.`,
            };
        }
    }
    if (counter) {
        for (const [index, run] of runs.entries()) {
            const stability = run.journeys[journey]?.counterStability?.[name];
            if (stability?.stable === false) {
                const values = Array.isArray(stability.values)
                    ? ` (iterations ${stability.values.join(', ')})`
                    : '';
                return {
                    measured,
                    reason: `unstable in run ${index + 1}${values}; the summary value hides iterations that disagreed.`,
                };
            }
        }
    }
    const highest = Math.max(...measured);
    if (highest >= entry.value) {
        return {
            measured,
            reason: `not below ${formatNumber(entry.value)} in every run (highest ${formatNumber(highest)}).`,
        };
    }
    return { measured, newValue: highest };
}

/**
 * Pure tightening. Returns the new baselines object and one row per entry so
 * the CLI and the PR body can show the per-run numbers.
 */
export function tightenBaselines({
    baselines,
    runs,
    evidenceRun,
    measuredWith = DEFAULT_MEASURED_WITH,
    date = new Date().toISOString().slice(0, 10),
}) {
    validateBaselines(baselines);
    if (runs.length < MIN_RUNS) {
        throw new Error(
            `Tightening needs at least ${MIN_RUNS} runs; received ${runs.length}.`
        );
    }
    if (!evidenceRun) {
        throw new Error('--evidence-run <workflow run URL> is required.');
    }
    const next = structuredClone(baselines);
    const rows = [];
    for (const [journey, entries] of Object.entries(baselines.journeys)) {
        for (const [name, entry] of Object.entries(entries)) {
            const decision = decide(entry, name, journey, runs);
            rows.push({
                label: `${journey}/${name}`,
                unit: entry.unit,
                value: entry.value,
                ...decision,
            });
            if (decision.newValue === undefined) continue;
            next.journeys[journey][name] = {
                ...entry,
                value: decision.newValue,
                updatedAt: date,
                measuredWith: `${measuredWith}, max of ${runs.length} runs`,
                evidenceRun,
            };
        }
    }
    const direction = compareBaselineDirection({ base: baselines, head: next });
    if (direction.failures.length > 0) {
        throw new Error(
            `Refusing to write a weakened baselines file: ${direction.failures.join(' ')}`
        );
    }
    const tightened = rows.filter((row) => row.newValue !== undefined);
    return { baselines: next, rows, tightened };
}

/** Sets `evidencePr` on the entries a tightening run wrote. */
export function fillEvidencePr({ baselines, evidenceRun, pr }) {
    validateBaselines(baselines);
    if (!Number.isInteger(pr) || pr <= 0) {
        throw new Error(`--fill-evidence-pr expects a PR number, got ${pr}.`);
    }
    const next = structuredClone(baselines);
    let filled = 0;
    for (const entries of Object.values(next.journeys)) {
        for (const entry of Object.values(entries)) {
            if (entry.evidenceRun !== evidenceRun) continue;
            entry.evidencePr = pr;
            filled += 1;
        }
    }
    if (filled === 0) {
        throw new Error(`No baseline carries evidenceRun ${evidenceRun}.`);
    }
    return { baselines: next, filled };
}

/** Markdown: readable in a terminal, and pasted as is into the PR body. */
export function formatReport({ rows, tightened }, runNames = []) {
    const runCount = Math.max(0, ...rows.map((row) => row.measured.length));
    const runHeaders = Array.from(
        { length: runCount },
        (_, index) => `Run ${index + 1}`
    );
    const lines = [
        `| Baseline | Value | ${runHeaders.join(' | ')} | Result |`,
        `| --- | ---: | ${runHeaders.map(() => '---:').join(' | ')} | --- |`,
    ];
    for (const row of rows) {
        const unit = row.unit ? ` ${row.unit}` : '';
        const cells = row.measured.map((value) =>
            typeof value === 'number' ? formatNumber(value) : '—'
        );
        const result =
            row.newValue !== undefined
                ? `lowered to ${formatNumber(row.newValue)}${unit}`
                : `kept: ${row.reason}`;
        lines.push(
            `| \`${row.label}\` | ${formatNumber(row.value)}${unit} | ${cells.join(' | ')} | ${result} |`
        );
    }
    if (runNames.length > 0) {
        lines.push('');
        for (const [index, name] of runNames.entries()) {
            lines.push(`- Run ${index + 1}: ${name}`);
        }
    }
    lines.push(
        '',
        tightened.length > 0
            ? `Tightened ${tightened.length} of ${rows.length} baselines.`
            : `No baseline was below its value in every run; nothing to tighten (${rows.length} checked).`
    );
    return lines.join('\n');
}

export function parseArgs(argv) {
    const options = {
        runs: [],
        baselines: DEFAULT_BASELINES_PATH,
        evidenceRun: null,
        report: null,
        measuredWith: DEFAULT_MEASURED_WITH,
        date: undefined,
        fillEvidencePr: null,
    };
    const valued = {
        '--run': (value) => options.runs.push(value),
        '--baselines': (value) => (options.baselines = value),
        '--evidence-run': (value) => (options.evidenceRun = value),
        '--report': (value) => (options.report = value),
        '--measured-with': (value) => (options.measuredWith = value),
        '--date': (value) => (options.date = value),
        '--fill-evidence-pr': (value) =>
            (options.fillEvidencePr = Number(value)),
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--') continue;
        const [flag, inline] = argument.split(/=(.*)/s, 2);
        if (!(flag in valued)) throw new Error(`Unknown argument: ${argument}`);
        const value = inline ?? argv[++index];
        if (value === undefined || value === '') {
            throw new Error(`Missing value for ${flag}`);
        }
        valued[flag](value);
    }
    if (
        options.date !== undefined &&
        !/^\d{4}-\d{2}-\d{2}$/.test(options.date)
    ) {
        throw new Error(`--date expects YYYY-MM-DD, got "${options.date}".`);
    }
    if (!options.evidenceRun) {
        throw new Error('--evidence-run <workflow run URL> is required.');
    }
    return options;
}

async function readJson(filePath) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Cannot read ${filePath}: ${error.message}`);
    }
}

/** Reads one run: a summary file, or every `*.json` directly in a directory. */
export async function readRun(runPath, runLabel) {
    let files = [runPath];
    if ((await stat(runPath)).isDirectory()) {
        files = (await readdir(runPath))
            .filter((name) => name.endsWith('.json'))
            .sort()
            .map((name) => path.join(runPath, name));
        if (files.length === 0) {
            throw new Error(`${runLabel}: no summary files in ${runPath}.`);
        }
    }
    const summaries = await Promise.all(files.map((file) => readJson(file)));
    return mergeRunSummaries(summaries, runLabel);
}

async function writeJson(filePath, value) {
    await writeFile(filePath, `${JSON.stringify(value, null, 4)}\n`);
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const baselinesPath = path.resolve(options.baselines);
        const baselines = await readJson(baselinesPath);
        if (options.fillEvidencePr !== null) {
            const { baselines: next, filled } = fillEvidencePr({
                baselines,
                evidenceRun: options.evidenceRun,
                pr: options.fillEvidencePr,
            });
            await writeJson(baselinesPath, next);
            console.log(
                `Set evidencePr ${options.fillEvidencePr} on ${filled} baselines.`
            );
        } else {
            const runs = await Promise.all(
                options.runs.map((run, index) =>
                    readRun(path.resolve(run), `run ${index + 1}`)
                )
            );
            const result = tightenBaselines({
                baselines,
                runs,
                evidenceRun: options.evidenceRun,
                measuredWith: options.measuredWith,
                date: options.date,
            });
            const report = formatReport(
                result,
                options.runs.map((run) => path.basename(path.resolve(run)))
            );
            console.log(report);
            if (options.report) await writeFile(options.report, `${report}\n`);
            if (result.tightened.length > 0) {
                await writeJson(baselinesPath, result.baselines);
            }
        }
    } catch (error) {
        console.error(`tighten-baselines: ${error.message}`);
        process.exitCode = 1;
    }
}
