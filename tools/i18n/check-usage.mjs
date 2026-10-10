#!/usr/bin/env node
/**
 * Fails when the renderer references a translation key that en.json lacks.
 * ngx-translate renders a missing key as the key itself, so the gap only
 * shows up on screen; this check catches it before review.
 *
 * Production `.ts` and `.html` files under the source roots are scanned,
 * with comments removed. A key counts as used when it appears as:
 *
 * - a quoted literal before `| translate`, in templates and inline templates;
 * - the first argument of a translate call: `instant`, `get` or `stream` on a
 *   receiver whose name contains "translat", a function whose name contains
 *   "translat" (`translateWithFallback`, `translateText`), `marker` or `t`;
 * - a dotted upper-case literal whose first segment is an en.json namespace,
 *   such as `'PORTALS.ITEMS'` in a constant map. Such a literal may also name
 *   a group of keys that code completes, as in `${prefix}.TITLE`;
 * - the static prefix of a template literal, `EPG.DIALOG.${name}`, which
 *   must name a group of keys.
 *
 * Keys assembled entirely at runtime cannot be checked here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectLeaves } from './check-drift.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');
export const EN_PATH = resolve(REPO_ROOT, 'apps/web/src/assets/i18n/en.json');
/** Projects that load apps/web/src/assets/i18n at runtime. */
export const SOURCE_ROOTS = [
    'apps/web/src',
    'apps/remote-control-web/src',
    'libs',
];

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out-tsc', 'testing']);
const SKIPPED_FILE =
    /\.(spec|test|e2e|stories)\.ts$|\.d\.ts$|\.spec-[\w-]+\.ts$|harness\.ts$|[\\/]test-stubs[\\/]/;
const KEY = '[A-Z][A-Z0-9_]*(?:\\.[A-Z0-9_]+)*';
const PIPE_USAGE = /(['"])([A-Za-z0-9_.-]+)\1\s*\|\s*translate\b/g;
const CALL_USAGE = new RegExp(
    `([A-Za-z_$][\\w$]*(?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*)*)\\s*\\(\\s*(['"\`])(${KEY})\\2`,
    'g'
);
const QUOTED_DOTTED = /(['"`])([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)\1/g;
const TEMPLATE_PREFIX = /`([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)*)\.\$\{/g;
const CODE_TOKENS =
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;

function isTranslateCall(callee) {
    const parts = callee.replace(/\s|\?/g, '').split('.');
    const name = parts.at(-1);
    if (/translat/i.test(name) || name === 'marker' || name === 't') {
        return true;
    }
    return (
        ['instant', 'get', 'stream'].includes(name) &&
        parts.length > 1 &&
        /translat/i.test(parts.at(-2))
    );
}

/** Replaces comments with blanks, keeping offsets and line numbers. */
export function stripComments(source, kind) {
    const blank = (text) => text.replace(/[^\n]/g, ' ');
    if (kind === 'html') {
        return source.replace(HTML_COMMENTS, blank);
    }
    return source.replace(CODE_TOKENS, (match, literal) =>
        literal ? match : blank(match)
    );
}

/**
 * Returns `{ key, index, kind }` for every reference in one file. `kind` is
 * `leaf` when the reference must be a translatable string and `group` when a
 * group of keys also satisfies it.
 */
export function findKeyReferences(source, kind, namespaces) {
    const code = stripComments(source, kind);
    const references = [];
    for (const match of code.matchAll(PIPE_USAGE)) {
        references.push({ key: match[2], index: match.index, kind: 'leaf' });
    }
    for (const match of code.matchAll(CALL_USAGE)) {
        if (isTranslateCall(match[1])) {
            references.push({
                key: match[3],
                index: match.index + match[0].lastIndexOf(match[2] + match[3]),
                kind: 'leaf',
            });
        }
    }
    for (const match of code.matchAll(QUOTED_DOTTED)) {
        if (namespaces.has(match[2].split('.')[0])) {
            references.push({
                key: match[2],
                index: match.index,
                kind: 'group',
            });
        }
    }
    for (const match of code.matchAll(TEMPLATE_PREFIX)) {
        if (namespaces.has(match[1].split('.')[0])) {
            references.push({
                key: match[1],
                index: match.index,
                kind: 'prefix',
            });
        }
    }
    return references;
}

function listSourceFiles(root) {
    let entries;
    try {
        entries = readdirSync(root);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    return entries.flatMap((entry) => {
        const path = resolve(root, entry);
        if (statSync(path).isDirectory()) {
            return SKIPPED_DIRS.has(entry) ? [] : listSourceFiles(path);
        }
        return /\.(ts|html)$/.test(entry) && !SKIPPED_FILE.test(path)
            ? [path]
            : [];
    });
}

function lineOf(source, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) {
        if (source.charCodeAt(i) === 10) {
            line += 1;
        }
    }
    return line;
}

/** Runs the check and returns the process exit code. */
export function run({
    repoRoot = REPO_ROOT,
    enPath = EN_PATH,
    sourceRoots = SOURCE_ROOTS,
    log = console.log,
} = {}) {
    let leaves;
    try {
        leaves = collectLeaves(JSON.parse(readFileSync(enPath, 'utf8')));
    } catch (error) {
        log(
            `FAIL ${enPath}: ${error instanceof Error ? error.message : error}`
        );
        return 1;
    }
    const groups = new Set();
    for (const key of leaves.keys()) {
        const segments = key.split('.');
        for (let end = 1; end < segments.length; end += 1) {
            groups.add(segments.slice(0, end).join('.'));
        }
    }
    const namespaces = new Set([...groups].filter((key) => !key.includes('.')));

    const missing = new Map();
    let files = 0;
    for (const root of sourceRoots) {
        for (const path of listSourceFiles(resolve(repoRoot, root))) {
            files += 1;
            const source = readFileSync(path, 'utf8');
            const kind = path.endsWith('.html') ? 'html' : 'ts';
            for (const reference of findKeyReferences(
                source,
                kind,
                namespaces
            )) {
                const known =
                    reference.kind === 'leaf'
                        ? leaves.has(reference.key)
                        : reference.kind === 'prefix'
                          ? groups.has(reference.key)
                          : leaves.has(reference.key) ||
                            groups.has(reference.key);
                if (known) {
                    continue;
                }
                const location = `${relative(repoRoot, path)}:${lineOf(
                    source,
                    reference.index
                )}`;
                if (!missing.has(reference.key)) {
                    missing.set(reference.key, new Set());
                }
                missing.get(reference.key).add(location);
            }
        }
    }

    if (missing.size === 0) {
        log(`ok usage: ${files} files, 0 keys missing from en.json`);
        return 0;
    }
    log(
        `FAIL usage: ${missing.size} key(s) are used but missing from en.json:`
    );
    for (const [key, locations] of [...missing].sort(([a], [b]) =>
        a < b ? -1 : 1
    )) {
        log(`  ${key}  ${[...locations].join(', ')}`);
    }
    log(
        'Add each key to en.json and translate it in every locale (see the i18n-fill skill).'
    );
    return 1;
}

const isMain =
    process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
    process.exitCode = run();
}
