/**
 * Compares a journey summary (written by the measurement scripts) against the
 * committed baselines in tools/performance/journey-baselines.json.
 *
 * Rules, from docs/architecture/performance-journeys.md:
 * - A counter above its baseline fails. Counters are exact; there is no slack.
 * - An entry with `toleranceRatio` (wall-clock) fails above
 *   `value * toleranceRatio`.
 * - A baseline without a measurement fails, so removing a measurement can
 *   never silently disable the ratchet.
 * - A measurement below its baseline prints a "can tighten" hint. Baselines
 *   are lowered by hand, with the measured output as evidence, never raised.
 *
 * Usage:
 *   node tools/performance/check-journey-ratchet.mjs --summary <summary.json>
 *       [--baselines tools/performance/journey-baselines.json]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASELINES_PATH =
    'tools/performance/journey-baselines.json';

function formatNumber(value) {
    return Number.isInteger(value)
        ? value.toLocaleString('en-US')
        : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateBaselines(baselines) {
    if (!isPlainObject(baselines) || !isPlainObject(baselines.journeys)) {
        throw new Error(
            'Baselines file must be an object with a "journeys" map.'
        );
    }
    for (const [journey, entries] of Object.entries(baselines.journeys)) {
        if (!isPlainObject(entries)) {
            throw new Error(
                `Baseline journey "${journey}" must map counter names to entries.`
            );
        }
        for (const [name, entry] of Object.entries(entries)) {
            const label = `${journey}/${name}`;
            if (!isPlainObject(entry) || !Number.isFinite(entry.value)) {
                throw new Error(
                    `Baseline ${label} needs a finite numeric "value".`
                );
            }
            if (
                entry.toleranceRatio !== undefined &&
                !(
                    Number.isFinite(entry.toleranceRatio) &&
                    entry.toleranceRatio >= 1
                )
            ) {
                throw new Error(
                    `Baseline ${label} has an invalid "toleranceRatio" (must be >= 1).`
                );
            }
        }
    }
    return baselines;
}

function measuredValue(summaryJourney, name) {
    if (!isPlainObject(summaryJourney)) return undefined;
    const counter = summaryJourney.counters?.[name];
    if (counter !== undefined) return counter;
    return summaryJourney.wallClock?.[name];
}

/**
 * Pure comparison. Returns every outcome so the CLI and tests can render it;
 * `failures` non-empty means the ratchet is broken.
 */
export function compareToBaselines({ baselines, summary }) {
    validateBaselines(baselines);
    const summaryJourneys = isPlainObject(summary?.journeys)
        ? summary.journeys
        : {};
    const result = {
        failures: [],
        tightenable: [],
        passed: [],
        unbaselined: [],
    };

    for (const [journey, entries] of Object.entries(baselines.journeys)) {
        for (const [name, entry] of Object.entries(entries)) {
            const label = `${journey}/${name}`;
            const unit = entry.unit ? ` ${entry.unit}` : '';
            const measured = measuredValue(summaryJourneys[journey], name);

            if (measured === undefined) {
                result.failures.push(
                    `${label}: baseline ${formatNumber(entry.value)}${unit} has no measurement in the summary. The ratchet cannot be bypassed by dropping a measurement; restore it.`
                );
                continue;
            }
            if (typeof measured !== 'number' || !Number.isFinite(measured)) {
                result.failures.push(
                    `${label}: measured value ${JSON.stringify(measured)} is not a finite number.`
                );
                continue;
            }

            const limit =
                entry.toleranceRatio !== undefined
                    ? entry.value * entry.toleranceRatio
                    : entry.value;
            const limitText =
                entry.toleranceRatio !== undefined
                    ? `${formatNumber(limit)} (baseline ${formatNumber(entry.value)} × ${entry.toleranceRatio})`
                    : `baseline ${formatNumber(entry.value)}`;

            if (measured > limit) {
                result.failures.push(
                    `${label}: ${formatNumber(measured)}${unit} exceeds ${limitText} by ${formatNumber(measured - limit)}${unit}. Bring the value back down; baselines only move down. If the growth is a deliberate trade-off, say so in the PR and let the maintainer decide.`
                );
            } else if (measured < entry.value) {
                result.tightenable.push(
                    `${label}: ${formatNumber(measured)}${unit} is below baseline ${formatNumber(entry.value)} by ${formatNumber(entry.value - measured)}${unit}. Lower the baseline in ${DEFAULT_BASELINES_PATH} with this run as evidence.`
                );
            } else {
                result.passed.push(
                    `${label}: ${formatNumber(measured)}${unit} within ${limitText}.`
                );
            }
        }
    }

    for (const [journey, summaryJourney] of Object.entries(summaryJourneys)) {
        const measuredNames = [
            ...Object.keys(summaryJourney?.counters ?? {}),
            ...Object.keys(summaryJourney?.wallClock ?? {}),
        ];
        for (const name of measuredNames) {
            if (baselines.journeys[journey]?.[name] === undefined) {
                result.unbaselined.push(
                    `${journey}/${name}: measured but has no baseline yet. Add one to ${DEFAULT_BASELINES_PATH} once the counter is validated.`
                );
            }
        }
    }

    return result;
}

export function formatResult(result) {
    const lines = [];
    for (const line of result.passed) lines.push(`ok       ${line}`);
    for (const line of result.tightenable) lines.push(`tighten  ${line}`);
    for (const line of result.unbaselined) lines.push(`note     ${line}`);
    for (const line of result.failures) lines.push(`FAIL     ${line}`);
    const checked =
        result.passed.length +
        result.tightenable.length +
        result.failures.length;
    lines.push(
        result.failures.length > 0
            ? `Journey ratchet failed: ${result.failures.length} of ${checked} baselines exceeded.`
            : `Journey ratchet OK: ${checked} baselines checked, ${result.tightenable.length} can be tightened.`
    );
    return lines.join('\n');
}

export function parseArgs(argv) {
    const options = { summary: null, baselines: DEFAULT_BASELINES_PATH };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--') continue;
        if (argument === '--summary') {
            options.summary = argv[++index];
        } else if (argument.startsWith('--summary=')) {
            options.summary = argument.slice('--summary='.length);
        } else if (argument === '--baselines') {
            options.baselines = argv[++index];
        } else if (argument.startsWith('--baselines=')) {
            options.baselines = argument.slice('--baselines='.length);
        } else {
            throw new Error(`Unknown argument: ${argument}`);
        }
        if (options.summary === undefined || options.baselines === undefined) {
            throw new Error(`Missing value for ${argument}`);
        }
    }
    if (!options.summary) {
        throw new Error('--summary <journey-summary.json> is required.');
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
        const baselines = await readJson(
            path.resolve(options.baselines),
            'baselines'
        );
        const summary = await readJson(
            path.resolve(options.summary),
            'journey summary'
        );
        const result = compareToBaselines({ baselines, summary });
        const output = formatResult(result);
        if (result.failures.length > 0) {
            console.error(output);
            process.exitCode = 1;
        } else {
            console.log(output);
        }
    } catch (error) {
        console.error(`check-journey-ratchet: ${error.message}`);
        process.exitCode = 1;
    }
}
