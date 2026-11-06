#!/usr/bin/env node
/**
 * Lists English strings that en.json defines under several keys while a
 * locale translates those keys differently ("Close" as "Fermer" in one dialog
 * and "Fermer la fenêtre" in another). Such groups are usually drift: one
 * wording was copied, the other translated later. Some are legitimate, where
 * the same English word needs a different grammatical form in context.
 *
 * The report is informational. `--max <n>` fails when more than n groups
 * diverge; `--verbose` prints every locale's variants.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectLeaves, I18N_DIR } from './check-drift.mjs';

const EN_LOCALE = 'en';

/**
 * Groups en.json keys by English text and returns every group of two or more
 * keys that at least one locale translates with more than one distinct value.
 * Each group lists, per diverging locale, the keys behind each variant.
 */
export function findDivergentDuplicates(enLeaves, leavesByLocale) {
    const keysByText = new Map();
    for (const [key, text] of enLeaves) {
        if (typeof text === 'string' && text.trim().length > 0) {
            keysByText.set(text, [...(keysByText.get(text) ?? []), key]);
        }
    }

    const groups = [];
    for (const [english, keys] of keysByText) {
        if (keys.length < 2) {
            continue;
        }
        const locales = new Map();
        for (const [locale, leaves] of leavesByLocale) {
            const variants = new Map();
            for (const key of keys) {
                const value = leaves.get(key);
                if (typeof value === 'string') {
                    variants.set(value, [...(variants.get(value) ?? []), key]);
                }
            }
            if (variants.size > 1) {
                locales.set(locale, variants);
            }
        }
        if (locales.size > 0) {
            groups.push({ english, keys, locales });
        }
    }

    return groups.sort(
        (a, b) =>
            b.locales.size - a.locales.size ||
            b.keys.length - a.keys.length ||
            (a.english < b.english ? -1 : 1)
    );
}

function readLeaves(i18nDir, locale) {
    return collectLeaves(
        JSON.parse(readFileSync(resolve(i18nDir, `${locale}.json`), 'utf8'))
    );
}

function parseArgs(argv) {
    const options = { max: undefined, verbose: false };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '--max' && /^\d+$/.test(argv[index + 1] ?? '')) {
            options.max = Number(argv[index + 1]);
            index += 1;
        } else if (arg !== '--') {
            return null;
        }
    }
    return options;
}

/** Runs the report and returns the process exit code. */
export function run({ i18nDir = I18N_DIR, argv = [], log = console.log } = {}) {
    const options = parseArgs(argv);
    if (!options) {
        log(
            `FAIL unsupported arguments: ${argv.join(' ')}; use --max <n> and --verbose.`
        );
        return 1;
    }

    const leavesByLocale = new Map(
        readdirSync(i18nDir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => file.slice(0, -'.json'.length))
            .filter((locale) => locale !== EN_LOCALE)
            .sort()
            .map((locale) => [locale, readLeaves(i18nDir, locale)])
    );
    const groups = findDivergentDuplicates(
        readLeaves(i18nDir, EN_LOCALE),
        leavesByLocale
    );

    for (const { english, keys, locales } of groups) {
        log(
            `${JSON.stringify(english)}: ${keys.length} keys, ${
                locales.size
            } locale(s) differ (${[...locales.keys()].join(', ')})`
        );
        if (options.verbose) {
            for (const [locale, variants] of locales) {
                for (const [value, variantKeys] of variants) {
                    log(
                        `  ${locale} ${JSON.stringify(value)}: ${variantKeys.join(', ')}`
                    );
                }
            }
        }
    }

    const over = options.max !== undefined && groups.length > options.max;
    log(
        `${over ? 'FAIL' : 'ok'} ${groups.length} duplicate English string(s) with diverging translations${
            options.max === undefined ? '' : ` (max ${options.max})`
        }`
    );
    return over ? 1 : 0;
}

const isMain =
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
    process.exitCode = run({ argv: process.argv.slice(2) });
}
