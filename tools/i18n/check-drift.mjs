#!/usr/bin/env node
/**
 * Compares every locale in apps/web/src/assets/i18n/ with en.json.
 *
 * Missing or extra keys fail. A value identical to English fails too, unless
 * tools/i18n/identical-en-baseline.json records that exact English text for
 * that locale and key. The baseline holds values that are legitimately the
 * same in a language (brands, technical terms, loanwords such as "PIN") and
 * the untranslated debt that existed when the guard was introduced, so new
 * keys must ship translated while old debt can be paid down.
 *
 * Baseline entries that no longer match an English-identical value are only
 * reported. `--update-baseline` rewrites the baseline from the current files;
 * run it deliberately and review the diff. CI never runs it.
 * `--fail-on-identical` ignores the baseline for a strict audit.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const I18N_DIR = resolve(__dirname, '../../apps/web/src/assets/i18n');
export const BASELINE_PATH = resolve(__dirname, 'identical-en-baseline.json');
const EN_LOCALE = 'en';
const MAX_EXAMPLES = 5;
const UPDATE_COMMAND = 'pnpm run i18n:baseline:update';
const FLAGS = new Set(['--fail-on-identical', '--update-baseline', '--']);

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function collectLeaves(value, prefix = '', leaves = new Map()) {
    if (!isPlainObject(value)) {
        throw new Error(`Expected object at ${prefix || '<root>'}`);
    }

    for (const [key, entry] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isPlainObject(entry)) {
            collectLeaves(entry, path, leaves);
        } else {
            leaves.set(path, entry);
        }
    }

    return leaves;
}

/** Keys whose non-empty locale string equals the English string. */
export function findIdenticalToEnglish(enLeaves, localeLeaves) {
    const identical = new Map();
    for (const [key, enValue] of enLeaves) {
        const localeValue = localeLeaves.get(key);
        if (
            typeof enValue === 'string' &&
            localeValue === enValue &&
            enValue.trim().length > 0
        ) {
            identical.set(key, enValue);
        }
    }
    return identical;
}

/**
 * Splits a locale's English-identical keys into baselined and new ones. An
 * entry covers a key only while its recorded text is still the English text,
 * so rewording English and copying the new text into a locale is new debt.
 * Stale entries no longer describe an English-identical value: the key was
 * translated or removed, or its English text changed.
 */
export function compareWithBaseline(identical, localeBaseline = new Map()) {
    const baselined = [];
    const unbaselined = [];
    for (const [key, value] of identical) {
        (localeBaseline.get(key) === value ? baselined : unbaselined).push(key);
    }
    const stale = [...localeBaseline]
        .filter(([key, value]) => identical.get(key) !== value)
        .map(([key]) => key);
    return { baselined, unbaselined, stale };
}

/** Validates the baseline JSON into Map<locale, Map<key, englishText>>. */
export function parseBaseline(raw) {
    if (!isPlainObject(raw)) {
        throw new Error('expected an object of locales');
    }
    const baseline = new Map();
    for (const [locale, entries] of Object.entries(raw)) {
        if (!isPlainObject(entries)) {
            throw new Error(`expected an object of keys for ${locale}`);
        }
        for (const [key, value] of Object.entries(entries)) {
            if (typeof value !== 'string') {
                throw new Error(`expected English text at ${locale} ${key}`);
            }
        }
        baseline.set(locale, new Map(Object.entries(entries)));
    }
    return baseline;
}

/** Serialises Map<locale, Map<key, text>> with locales and keys sorted. */
export function serializeBaseline(identicalByLocale) {
    const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const output = {};
    for (const locale of [...identicalByLocale.keys()].sort(byCodeUnit)) {
        const entries = identicalByLocale.get(locale);
        if (entries.size > 0) {
            output[locale] = Object.fromEntries(
                [...entries].sort(([a], [b]) => byCodeUnit(a, b))
            );
        }
    }
    return `${JSON.stringify(output, null, 4)}\n`;
}

function countChanges(from, to, onChange = () => undefined) {
    let changes = 0;
    for (const [locale, entries] of from) {
        for (const [key, value] of entries) {
            if (to.get(locale)?.get(key) !== value) {
                changes += 1;
                onChange(locale, key, value);
            }
        }
    }
    return changes;
}

function formatExamples(values) {
    if (values.length === 0) {
        return '';
    }

    const suffix = values.length > MAX_EXAMPLES ? ', ...' : '';
    return ` (${values.slice(0, MAX_EXAMPLES).join(', ')}${suffix})`;
}

function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}

function readBaseline(baselinePath) {
    let raw;
    try {
        raw = readJson(baselinePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return new Map();
        }
        throw new Error(`${baselinePath}: ${formatError(error)}`);
    }
    try {
        return parseBaseline(raw);
    } catch (error) {
        throw new Error(`${baselinePath}: ${formatError(error)}`);
    }
}

function listLocales(i18nDir) {
    return readdirSync(i18nDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length))
        .filter((locale) => locale !== EN_LOCALE)
        .sort();
}

function checkLocale({ i18nDir, locale, enLeaves, baseline, mode }) {
    const localeLeaves = collectLeaves(
        readJson(resolve(i18nDir, `${locale}.json`))
    );
    const missing = [...enLeaves.keys()].filter(
        (key) => !localeLeaves.has(key)
    );
    const extra = [...localeLeaves.keys()].filter((key) => !enLeaves.has(key));
    const identical = findIdenticalToEnglish(enLeaves, localeLeaves);
    const { baselined, unbaselined, stale } = compareWithBaseline(
        identical,
        baseline.get(locale)
    );
    const rejected =
        mode === 'strict'
            ? [...identical.keys()]
            : mode === 'update'
              ? []
              : unbaselined;
    return { missing, extra, identical, baselined, rejected, stale };
}

function reportLocale(log, file, result, mode) {
    const { missing, extra, identical, baselined, rejected, stale } = result;
    const failed = missing.length + extra.length + rejected.length > 0;
    const baselineNote =
        mode === 'baseline' ? ` baselined=${baselined.length}` : '';
    log(
        `${failed ? 'FAIL' : 'ok'} ${file}: missing=${
            missing.length
        }${formatExamples(missing)} extra=${extra.length}${formatExamples(
            extra
        )} identical_en=${identical.size}${baselineNote}`
    );
    if (mode === 'baseline' && stale.length > 0) {
        log(
            `note ${file}: ${stale.length} baseline entries are no longer English-identical${formatExamples(
                stale
            )}`
        );
    }
    return failed;
}

function reportRejected(log, rejected, enLeaves, mode) {
    if (rejected.length === 0) {
        return;
    }
    const scope = mode === 'strict' ? '' : ' and are not in the baseline';
    log(`${rejected.length} value(s) equal English${scope}:`);
    for (const [file, key] of rejected) {
        log(`  ${file} ${key}: ${JSON.stringify(enLeaves.get(key))}`);
    }
    if (mode === 'baseline') {
        log(
            `Translate them (see the i18n-fill skill). Only if a value is legitimately the same in that language, run \`${UPDATE_COMMAND}\` and commit the reviewed baseline.`
        );
    }
}

function writeBaseline(log, baselinePath, previous, identicalByLocale) {
    const added = countChanges(
        identicalByLocale,
        previous,
        (locale, key, value) =>
            log(`  + ${locale} ${key}: ${JSON.stringify(value)}`)
    );
    const removed = countChanges(previous, identicalByLocale);
    writeFileSync(baselinePath, serializeBaseline(identicalByLocale));
    log(
        `Baseline written: ${added} added, ${removed} removed. Review every added entry before committing.`
    );
}

/** Runs the check and returns the process exit code. */
export function run({
    i18nDir = I18N_DIR,
    baselinePath = BASELINE_PATH,
    argv = [],
    log = console.log,
} = {}) {
    const strict = argv.includes('--fail-on-identical');
    const update = argv.includes('--update-baseline');
    if (argv.some((arg) => !FLAGS.has(arg)) || (strict && update)) {
        log(
            `FAIL unsupported arguments: ${argv.join(' ')}; pass at most one of --fail-on-identical and --update-baseline.`
        );
        return 1;
    }
    const mode = strict ? 'strict' : update ? 'update' : 'baseline';

    let enLeaves;
    let baseline;
    try {
        enLeaves = collectLeaves(
            readJson(resolve(i18nDir, `${EN_LOCALE}.json`))
        );
        // A strict audit ignores the baseline, so a damaged file cannot block it.
        baseline = strict ? new Map() : readBaseline(baselinePath);
    } catch (error) {
        if (!enLeaves || !update) {
            log(`FAIL ${formatError(error)}`);
            return 1;
        }
        log(`note replacing unreadable baseline: ${formatError(error)}`);
        baseline = new Map();
    }

    const locales = listLocales(i18nDir);
    const identicalByLocale = new Map();
    const rejected = [];
    let failed = false;
    let staleTotal = 0;

    for (const locale of locales) {
        const file = `${locale}.json`;
        let result;
        try {
            result = checkLocale({ i18nDir, locale, enLeaves, baseline, mode });
        } catch (error) {
            failed = true;
            log(`FAIL ${file}: ${formatError(error)}`);
            continue;
        }
        identicalByLocale.set(locale, result.identical);
        rejected.push(...result.rejected.map((key) => [file, key]));
        staleTotal += result.stale.length;
        failed = reportLocale(log, file, result, mode) || failed;
    }

    if (mode === 'baseline') {
        for (const [locale, entries] of baseline) {
            if (!locales.includes(locale)) {
                staleTotal += entries.size;
                log(`note ${locale}: baseline lists a locale with no file`);
            }
        }
        if (staleTotal > 0) {
            log(
                `note ${staleTotal} stale baseline entries; run \`${UPDATE_COMMAND}\` to shrink the baseline.`
            );
        }
    }
    reportRejected(log, rejected, enLeaves, mode);

    if (update) {
        // Only a complete, readable set of locales is a state worth recording.
        if (failed) {
            log(
                'FAIL baseline not written: fix the unreadable, missing or extra keys above first.'
            );
            return 1;
        }
        writeBaseline(log, baselinePath, baseline, identicalByLocale);
    }

    return failed ? 1 : 0;
}

const isMain =
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
    process.exitCode = run({ argv: process.argv.slice(2) });
}
