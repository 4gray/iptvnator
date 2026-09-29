/**
 * Refuses a change that weakens tools/performance/journey-baselines.json.
 *
 * The ratchet job compares a measurement with the baselines file of the same
 * commit, so on its own it cannot tell a genuine payload reduction from a PR
 * that grows the payload and raises the baseline by the same amount. This
 * check closes that gap: given the baselines file of the target branch and
 * the one of the PR, any entry whose enforced limit (`value × toleranceRatio`
 * or `value + slack`) went up, whose tolerance or slack widened, or that
 * disappeared, is a failure. A counter's `value` may not go up either, even
 * when narrower slack lowers its limit: the value is the measured evidence.
 * Switching an entry between counter and wall-clock (adding or removing
 * `toleranceRatio`) is a weakening too, so that rule cannot be sidestepped.
 * New entries and lowered limits pass.
 *
 * `--allow-increase` turns those failures into printed "allowed" lines. CI
 * passes it only when a maintainer put the perf-baseline-increase label on
 * the pull request, so a deliberate increase stays visible and needs a
 * decision instead of being impossible.
 *
 * Usage:
 *   node tools/performance/check-baseline-direction.mjs \
 *       --base <target-branch-journey-baselines.json> \
 *       --head tools/performance/journey-baselines.json [--allow-increase]
 *
 * A missing --base file means the target branch has no baselines yet, so
 * there is nothing that could have been weakened.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    BASELINE_INCREASE_LABEL,
    enforcedLimit,
    validateBaselines,
} from './check-journey-ratchet.mjs';

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

/**
 * Pure comparison; `failures` non-empty means the change weakens the ratchet.
 * With `allowIncrease` every weakening lands in `allowed` instead.
 */
export function compareBaselineDirection({
    base,
    head,
    allowIncrease = false,
}) {
    validateBaselines(base);
    validateBaselines(head);
    const result = {
        failures: [],
        allowed: [],
        lowered: [],
        unchanged: [],
        added: [],
    };
    const weakened = allowIncrease ? result.allowed : result.failures;
    const headEntries = entries(head);

    for (const [label, baseEntry] of entries(base)) {
        const headEntry = headEntries.get(label);
        const unit = baseEntry.unit ? ` ${baseEntry.unit}` : '';
        if (!headEntry) {
            weakened.push(
                `${label}: baseline ${formatNumber(baseEntry.value)}${unit} was removed. Baselines are retired only by a maintainer decision recorded in the PR, not by deleting the entry.`
            );
            continue;
        }
        const kind = (entry) =>
            entry.toleranceRatio === undefined ? 'counter' : 'wall-clock';
        const baseTolerance = baseEntry.toleranceRatio ?? 1;
        const headTolerance = headEntry.toleranceRatio ?? 1;
        const baseSlack = baseEntry.slack ?? 0;
        const headSlack = headEntry.slack ?? 0;
        const baseLimit = enforcedLimit(baseEntry);
        const headLimit = enforcedLimit(headEntry);
        if (headTolerance > baseTolerance) {
            weakened.push(
                `${label}: toleranceRatio widened from ${baseTolerance} to ${headTolerance}. Tolerances are a maintainer decision (the ${BASELINE_INCREASE_LABEL} label); a PR may only narrow them.`
            );
        } else if (kind(baseEntry) !== kind(headEntry)) {
            weakened.push(
                `${label}: changed from a ${kind(baseEntry)} entry to a ${kind(headEntry)} entry. The two are read from different summary sections and compared differently, so a type change is a maintainer decision (the ${BASELINE_INCREASE_LABEL} label).`
            );
        } else if (headSlack > baseSlack) {
            weakened.push(
                `${label}: slack widened from ${formatNumber(baseSlack)} to ${formatNumber(headSlack)}${unit}. Slack is a maintainer decision (the ${BASELINE_INCREASE_LABEL} label); a PR may only narrow it.`
            );
        } else if (headLimit > baseLimit) {
            weakened.push(
                `${label}: baseline raised from ${formatNumber(baseLimit)} to ${formatNumber(headLimit)}${unit}. Baselines only move down; bring the measurement back under ${formatNumber(baseLimit)}, or make the case for the increase in the PR and ask a maintainer to add the ${BASELINE_INCREASE_LABEL} label.`
            );
        } else if (
            headEntry.toleranceRatio === undefined &&
            headEntry.value > baseEntry.value
        ) {
            weakened.push(
                `${label}: baseline value raised from ${formatNumber(baseEntry.value)} to ${formatNumber(headEntry.value)}${unit} while slack narrowed from ${formatNumber(baseSlack)} to ${formatNumber(headSlack)}. A counter's value only moves down; narrowing its slack does not offset a raise. Ask a maintainer to add the ${BASELINE_INCREASE_LABEL} label if the raise is deliberate.`
            );
        } else if (headLimit < baseLimit) {
            result.lowered.push(
                `${label}: ${formatNumber(baseLimit)} -> ${formatNumber(headLimit)}${unit}.`
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
    for (const line of result.allowed) lines.push(`ALLOWED  ${line}`);
    for (const line of result.failures) lines.push(`FAIL     ${line}`);
    const allowed =
        result.allowed.length > 0
            ? `, ${result.allowed.length} weakened with the ${BASELINE_INCREASE_LABEL} label`
            : '';
    lines.push(
        result.failures.length > 0
            ? `Baseline direction check failed: ${result.failures.length} entries raised or removed.`
            : `Baseline direction OK: ${result.unchanged.length} unchanged, ${result.lowered.length} lowered, ${result.added.length} added${allowed}.`
    );
    return lines.join('\n');
}

export function parseArgs(argv) {
    const options = {
        base: null,
        head: DEFAULT_HEAD_PATH,
        allowIncrease: false,
    };
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
        } else if (argument === '--allow-increase') {
            options.allowIncrease = true;
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
        const result = compareBaselineDirection({
            base,
            head,
            allowIncrease: options.allowIncrease,
        });
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
