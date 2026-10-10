import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two ways a style silently stops following the app theme:
 *
 * - A `var(--name)` read whose property nothing declares resolves to its
 *   fallback, or to nothing, without an error: a renamed or removed token
 *   quietly changes what users see.
 * - A `prefers-color-scheme` query follows the OS, while the app theme is the
 *   `.dark-theme` class set from Settings. With the app set to dark on a light
 *   OS such a rule paints light-theme colours into the dark theme.
 */

/** Source files whose styles or templates can read custom properties. */
const SCANNED_PATHSPECS = [
    'apps/*.scss',
    'apps/*.css',
    'apps/*.ts',
    'apps/*.html',
    'libs/*.scss',
    'libs/*.css',
    'libs/*.ts',
    'libs/*.html',
];

/** Material and CDK declare these in their own stylesheets. */
const EXTERNAL_PREFIX = /^--(mat|mdc|cdk)-/;

/** Properties declared by a third-party stylesheet the app loads. */
const EXTERNAL_PROPERTIES = new Map([['--art-subtitle-bottom', 'artplayer']]);

/**
 * Resolves the "system" theme setting to the app class; the one place that
 * may ask for the OS colour scheme.
 */
const COLOR_SCHEME_RESOLVER = 'apps/web/src/app/services/settings.service.ts';

const NAME = '--[A-Za-z0-9_-]+';
const READ = new RegExp(`var\\(\\s*(${NAME})`, 'g');
const DECLARATIONS = [
    // `--name: value` in a stylesheet, style attribute or style string. A BEM
    // modifier before a pseudo-class (`.row--current:hover`, `&--open:focus`)
    // is a selector, not a declaration.
    new RegExp(`(?<![\\w&-])(${NAME})\\s*:`, 'g'),
    // `style.setProperty('--name', …)`, possibly across lines.
    new RegExp(`setProperty\\(\\s*['"\`](${NAME})['"\`]`, 'g'),
    // `[style.--name]="…"` and `'[style.--name]': …` host bindings, with or
    // without a unit suffix (`[style.--name.px]`).
    new RegExp(`\\[style\\.(${NAME})(?:\\.[a-z%]+)?\\]`, 'g'),
    // `{ '--name': value }` style objects.
    new RegExp(`['"](${NAME})['"]\\s*:`, 'g'),
];
const COLOR_SCHEME_QUERY = /prefers-color-scheme/g;

/**
 * Sources that never ship in the app. Their reads are not user-visible, and a
 * declaration in one (an E2E `setProperty`, a test stub) would mask a runtime
 * read that nothing in the app declares. The marketing website is a separate
 * site that themes itself from the OS.
 */
const NON_RUNTIME = [
    /\.(spec|test|e2e)\.[cm]?[jt]s$/,
    /\.(test-helpers|test-stubs|spec-data|e2e-support|stories)\.[cm]?[jt]s$/,
    /(^|\/)testing\//,
    /^apps\/[^/]+-(e2e|mock-server)\//,
    /^apps\/website\//,
];

function isScanned(file) {
    return !NON_RUNTIME.some((pattern) => pattern.test(file));
}

/**
 * Blanks comments, keeping every newline so reported lines stay exact. A
 * `//` only starts a comment at a line start or after whitespace, so URLs
 * such as `https://…` survive.
 */
export function stripComments(source) {
    const blank = (match) => match.replace(/[^\n]/g, ' ');
    return source
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/<!--[\s\S]*?-->/g, blank)
        .replace(
            /(^|[ \t])\/\/[^\n]*/gm,
            (match, lead) => lead + blank(match.slice(lead.length))
        );
}

/** Maps a character offset in `source` to its 1-based line number. */
function lineLocator(source) {
    const starts = [0];
    for (
        let i = source.indexOf('\n');
        i !== -1;
        i = source.indexOf('\n', i + 1)
    ) {
        starts.push(i + 1);
    }
    return (index) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (starts[mid] <= index) low = mid;
            else high = mid - 1;
        }
        return low + 1;
    };
}

export function collectReferences(file, source) {
    const code = stripComments(source);
    const lineAt = lineLocator(code);
    const reads = [];
    const declared = new Set();
    for (const match of code.matchAll(READ)) {
        reads.push({ file, line: lineAt(match.index), name: match[1] });
    }
    for (const pattern of DECLARATIONS) {
        for (const match of code.matchAll(pattern)) {
            declared.add(match[1]);
        }
    }
    return { reads, declared };
}

/** Reads of properties that no scanned source or known stylesheet declares. */
export function findUndeclaredReads(sources) {
    const reads = [];
    const declared = new Set();
    for (const { file, source } of sources) {
        const references = collectReferences(file, source);
        reads.push(...references.reads);
        for (const name of references.declared) declared.add(name);
    }
    return reads.filter(
        ({ name }) =>
            !declared.has(name) &&
            !EXTERNAL_PREFIX.test(name) &&
            !EXTERNAL_PROPERTIES.has(name)
    );
}

export function findColorSchemeQueries(file, source) {
    if (file === COLOR_SCHEME_RESOLVER) return [];
    const code = stripComments(source);
    const lineAt = lineLocator(code);
    return [...code.matchAll(COLOR_SCHEME_QUERY)].map((match) => ({
        file,
        line: lineAt(match.index),
    }));
}

/** Tracked files under `rootDir` that the guard reads, at any depth. */
export function listScannedFiles(rootDir) {
    // No shell: `cmd.exe` treats single quotes as literal characters, so a
    // POSIX-quoted pathspec reaches git intact on Windows and matches nothing.
    return execFileSync('git', ['ls-files', ...SCANNED_PATHSPECS], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
        .trim()
        .split('\n')
        .filter(Boolean)
        .filter(isScanned);
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const files = listScannedFiles(rootDir);
    const sources = await Promise.all(
        files.map(async (file) => ({
            file,
            source: await readFile(path.join(rootDir, file), 'utf8'),
        }))
    );

    const undeclared = findUndeclaredReads(sources);
    const colorSchemeQueries = sources.flatMap(({ file, source }) =>
        findColorSchemeQueries(file, source)
    );

    if (undeclared.length > 0) {
        console.error(
            'Custom properties read with var() but declared nowhere; they always fall back. Use a declared --app-* token, or declare the property:'
        );
        for (const { file, line, name } of undeclared) {
            console.error(`- ${file}:${line} ${name}`);
        }
        process.exitCode = 1;
    }
    if (colorSchemeQueries.length > 0) {
        console.error(
            'prefers-color-scheme follows the OS, not the app theme. Use --app-* tokens, or :host-context(.dark-theme) for a dark-only rule:'
        );
        for (const { file, line } of colorSchemeQueries) {
            console.error(`- ${file}:${line}`);
        }
        process.exitCode = 1;
    }
    if (!process.exitCode) {
        console.log(
            `Checked ${files.length} source files; every var() read is declared and no style follows the OS colour scheme.`
        );
    }
}
