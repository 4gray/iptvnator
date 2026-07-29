#!/usr/bin/env node

/**
 * Regenerates tools/eslint/max-lines-baseline.mjs: the list of TypeScript
 * files that already exceed the max-lines limit enforced in eslint.config.mjs.
 * Baselined files are exempt from the rule; the list should only shrink.
 *
 * The offender check runs ESLint's own `max-lines` rule through `Linter`,
 * against a config mirroring the real one (production vs test ceiling, shared
 * options), rather than counting lines here. Reimplementing the count would
 * silently disagree with the rule the moment either side changed — a `//`
 * inside a template literal is enough — and a baseline that disagrees with the
 * rule turns CI red while looking correct.
 *
 * Files that carry their own file-wide `eslint-disable max-lines` comment are
 * skipped: they are already exempt with a written justification next to the
 * code, which is the preferred escape hatch for a file that genuinely cannot
 * be split (for example a function serialized into another process).
 *
 * Usage: node tools/eslint/generate-max-lines-baseline.mjs
 */

import { Linter } from 'eslint';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import tsParser from '@typescript-eslint/parser';

import {
    MAX_LINES_OPTIONS,
    MAX_LINES_PROD,
    MAX_LINES_TEST,
    TEST_FILE_GLOBS,
} from './max-lines-config.mjs';

// Resolved from this file rather than cwd, so importing the module from a test
// (or running the script from a subdirectory) scans the same tree either way.
const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);
const scanRoots = ['apps', 'libs', 'tools'];
const skipDirs = new Set(['node_modules', 'dist', '.nx', 'coverage']);

/**
 * Mirrors the two max-lines blocks in eslint.config.mjs. The baseline block is
 * deliberately absent — an already-baselined file must still report here, or
 * the list could never be re-derived.
 */
const lintConfig = [
    {
        files: ['**/*.ts', '**/*.tsx'],
        ignores: TEST_FILE_GLOBS,
        languageOptions: { parser: tsParser },
        rules: {
            'max-lines': [
                'error',
                { max: MAX_LINES_PROD, ...MAX_LINES_OPTIONS },
            ],
        },
    },
    {
        files: TEST_FILE_GLOBS,
        languageOptions: { parser: tsParser },
        rules: {
            'max-lines': [
                'error',
                { max: MAX_LINES_TEST, ...MAX_LINES_OPTIONS },
            ],
        },
    },
];

const linter = new Linter();

function collectTsFiles(dir, results) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!skipDirs.has(entry.name)) {
                collectTsFiles(path.join(dir, entry.name), results);
            }
        } else if (
            (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
            !entry.name.endsWith('.d.ts')
        ) {
            results.push(path.join(dir, entry.name));
        }
    }
    return results;
}

/**
 * True when the file already suppresses max-lines with a file-wide
 * `/* eslint-disable *\/` comment. Those files are deliberately exempt with a
 * reviewed justification, so baselining them too would be redundant — and
 * would wrongly imply they merely predate the rule.
 */
function hasInlineMaxLinesDisable(content) {
    // Only a file-wide `eslint-disable` block comment can suppress max-lines;
    // the rule reports at the line where the limit is exceeded, so
    // `eslint-disable-next-line` cannot apply to it.
    const disableComments = content.matchAll(
        /\/\*\s*eslint-disable\s*([^*]*?)\*\//g
    );
    for (const [, ruleList = ''] of disableComments) {
        // `/* eslint-disable */` with no rules disables everything.
        const rules = ruleList.split('--')[0].trim();
        if (rules === '') {
            return true;
        }
        if (rules.split(',').some((rule) => rule.trim() === 'max-lines')) {
            return true;
        }
    }
    return false;
}

/** Repo-relative POSIX path — what the flat-config globs are matched against. */
function toRelativePosix(filePath) {
    return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}

function exceedsLimit(content, relativePath) {
    const messages = linter.verify(content, lintConfig, relativePath);
    return messages.some((message) => message.ruleId === 'max-lines');
}

/**
 * The repo-relative paths that currently exceed their bucket's limit, sorted.
 * Exported so a test can assert the committed baseline still matches, which is
 * what keeps stale entries and forgotten regenerations out of the list.
 */
export function computeOffenders() {
    return scanRoots
        .flatMap((root) => collectTsFiles(path.join(workspaceRoot, root), []))
        .map((filePath) => {
            const content = readFileSync(filePath, 'utf8');
            return { file: toRelativePosix(filePath), content };
        })
        .filter(
            ({ content, file }) =>
                !hasInlineMaxLinesDisable(content) &&
                exceedsLimit(content, file)
        )
        .map(({ file }) => file)
        .sort((a, b) => a.localeCompare(b));
}

/** The exact file contents for a given offender list. */
export function renderBaseline(offenders) {
    const banner = `// Generated by tools/eslint/generate-max-lines-baseline.mjs — do not edit by hand.
// TypeScript files that predate the max-lines ESLint rule (${MAX_LINES_PROD} for
// production code, ${MAX_LINES_TEST} for tests; blank lines and comments are not counted).
// This list should only shrink: split a file below the limit, rerun the
// generator, and commit the result. Never add new files here.
// A new file that genuinely cannot be split takes a file-wide
// \`/* eslint-disable max-lines -- <why> */\` instead; the generator skips those.
`;
    const body = offenders.map((file) => `    '${file}',`).join('\n');
    return `${banner}export const maxLinesBaseline = [\n${body}\n];\n`;
}

export const BASELINE_PATH = path.join(
    workspaceRoot,
    'tools/eslint/max-lines-baseline.mjs'
);

// Only write when run as a script — importing this module must not mutate the
// baseline it is used to verify.
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const offenders = computeOffenders();
    writeFileSync(BASELINE_PATH, renderBaseline(offenders));
    console.log(
        `Baselined ${offenders.length} files (prod > ${MAX_LINES_PROD}, test > ${MAX_LINES_TEST}).`
    );
}
