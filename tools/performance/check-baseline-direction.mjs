/**
 * Refuses a change that weakens tools/performance/journey-baselines.json.
 *
 * The ratchet job compares a measurement with the baselines file of the same
 * commit, so on its own it cannot tell a genuine payload reduction from a PR
 * that grows the payload and raises the baseline by the same amount. This
 * check closes that gap: given the baselines file of the target branch and
 * the one of the PR, any entry whose value went up, or that disappeared, is a
 * failure. New entries and lowered values pass.
 *
 * Usage:
 *   node tools/performance/check-baseline-direction.mjs \
 *       --base <target-branch-journey-baselines.json> \
 *       --head tools/performance/journey-baselines.json
 *
 * A missing --base file means the target branch has no baselines yet, so
 * there is nothing that could have been weakened.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBaselines } from './check-journey-ratchet.mjs';

export const DEFAULT_HEAD_PATH = 'tools/performance/journey-baselines.json';

function entries(baselines) {
    const flat = new Map();
    for (const [journey, counters] of Object.entries(baselines.journeys)) {
        for (const [name, entry] of Object.entries(counters)) {
            flat.set(`${journey}/${name}`, entry);
        }
    }
    return flat;
}

function formatNumber(value) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Pure comparison; `failures` non-empty means the change weakens the ratchet. */
export function compareBaselineDirection({ base, head }) {
    validateBaselines(base);
    validateBaselines(head);
    const result = { failures: [], lowered: [], unchanged: [], added: [] };
    const headEntries = entries(head);

    for (const [label, baseEntry] of entries(base)) {
        const headEntry = headEntries.get(label);
        const unit = baseEntry.unit ? ` ${baseEntry.unit}` : '';
        if (!headEntry) {
            result.failures.push(
                `${label}: baseline ${formatNumber(baseEntry.value)}${unit} was removed. Baselines are retired only by a maintainer decision recorded in the PR, not by deleting the entry.`
            );
        } else if (headEntry.value > baseEntry.value) {
            result.failures.push(
                `${label}: baseline raised from ${formatNumber(baseEntry.value)} to ${formatNumber(headEntry.value)}${unit}. Baselines only move down; bring the measurement back under ${formatNumber(baseEntry.value)} or make the case for the increase in the PR.`
            );
        } else if (headEntry.value < baseEntry.value) {
            result.lowered.push(
                `${label}: ${formatNumber(baseEntry.value)} -> ${formatNumber(headEntry.value)}${unit}.`
            );
        } else {
            result.unchanged.push(label);
        }
    }
    for (const label of headEntries.keys()) {
        if (!entries(base).has(label)) result.added.push(label);
    }
    return result;
}

export function formatDirectionResult(result) {
    const lines = [];
    for (const line of result.lowered) lines.push(`lowered  ${line}`);
    for (const label of result.added) lines.push(`added    ${label}`);
    for (const line of result.failures) lines.push(`FAIL     ${line}`);
    lines.push(
        result.failures.length > 0
            ? `Baseline direction check failed: ${result.failures.length} entries raised or removed.`
            : `Baseline direction OK: ${result.unchanged.length} unchanged, ${result.lowered.length} lowered, ${result.added.length} added.`
    );
    return lines.join('\n');
}

export function parseArgs(argv) {
    const options = { base: null, head: DEFAULT_HEAD_PATH };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--') continue;
        if (argument === '--base') {
            options.base = argv[++index];
        } else if (argument.startsWith('--base=')) {
            options.base = argument.slice('--base='.length);
        } else if (argument === '--head') {
            options.head = argv[++index];
        } else if (argument.startsWith('--head=')) {
            options.head = argument.slice('--head='.length);
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
        if (options.base === undefined || options.head === undefined) {
            throw new Error(`Missing value for ${argument}`);
        }
    }
    if (!options.base) {
        throw new Error(
            '--base <target-branch-journey-baselines.json> is required.'
        );
    }
    return options;
}

async function readJson(filePath, description) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        throw new Error(
            `Cannot read ${description} at ${filePath}: ${error.message}`
        );
    }
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    try {
        const options = parseArgs(process.argv.slice(2));
        const basePath = path.resolve(options.base);
        const base = existsSync(basePath)
            ? await readJson(basePath, 'target-branch baselines')
            : { version: 1, journeys: {} };
        if (!existsSync(basePath)) {
            console.log(
                `No baselines file at ${options.base} on the target branch; nothing to weaken.`
            );
        }
        const head = await readJson(path.resolve(options.head), 'baselines');
        const result = compareBaselineDirection({ base, head });
        const output = formatDirectionResult(result);
        if (result.failures.length > 0) {
            console.error(output);
            process.exitCode = 1;
        } else {
            console.log(output);
        }
    } catch (error) {
        console.error(`check-baseline-direction: ${error.message}`);
        process.exitCode = 1;
    }
}
