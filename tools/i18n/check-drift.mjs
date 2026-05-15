#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const I18N_DIR = resolve(REPO_ROOT, 'apps/web/src/assets/i18n');
const EN_LOCALE = 'en.json';
const MAX_EXAMPLES = 5;
const FAIL_ON_IDENTICAL = process.argv.includes('--fail-on-identical');

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function collectLeaves(value, prefix = '', leaves = new Map()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Expected object at ${prefix || '<root>'}`);
    }

    for (const [key, entry] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            collectLeaves(entry, path, leaves);
        } else {
            leaves.set(path, entry);
        }
    }

    return leaves;
}

function listLocaleFiles() {
    return readdirSync(I18N_DIR)
        .filter((file) => file.endsWith('.json'))
        .sort();
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

let enLeaves;
try {
    enLeaves = collectLeaves(readJson(resolve(I18N_DIR, EN_LOCALE)));
} catch (error) {
    console.error(`FAIL ${EN_LOCALE}: ${formatError(error)}`);
    process.exit(1);
}

const enKeys = [...enLeaves.keys()];
let failed = false;
let identicalTotal = 0;

for (const localeFile of listLocaleFiles()) {
    if (localeFile === EN_LOCALE) {
        continue;
    }

    try {
        const localeLeaves = collectLeaves(
            readJson(resolve(I18N_DIR, localeFile))
        );
        const localeKeys = [...localeLeaves.keys()];
        const missing = enKeys.filter((key) => !localeLeaves.has(key));
        const extra = localeKeys.filter((key) => !enLeaves.has(key));
        const identical = enKeys.filter((key) => {
            if (!localeLeaves.has(key)) {
                return false;
            }

            const localeValue = localeLeaves.get(key);
            const enValue = enLeaves.get(key);

            return (
                typeof localeValue === 'string' &&
                typeof enValue === 'string' &&
                localeValue.trim().length > 0 &&
                localeValue === enValue
            );
        });

        identicalTotal += identical.length;
        const localeFailed =
            missing.length > 0 ||
            extra.length > 0 ||
            (FAIL_ON_IDENTICAL && identical.length > 0);
        failed = failed || localeFailed;

        const status = localeFailed ? 'FAIL' : 'ok';
        console.log(
            `${status} ${localeFile}: missing=${missing.length}${formatExamples(
                missing
            )} extra=${extra.length}${formatExamples(extra)} identical_en=${
                identical.length
            }${formatExamples(identical)}`
        );
    } catch (error) {
        failed = true;
        console.log(`FAIL ${localeFile}: ${formatError(error)}`);
    }
}

if (identicalTotal > 0 && !FAIL_ON_IDENTICAL) {
    console.log(
        `warn identical_en=${identicalTotal}; pass --fail-on-identical to make English fallback values fatal.`
    );
}

if (failed) {
    process.exitCode = 1;
}
