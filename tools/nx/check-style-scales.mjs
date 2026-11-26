import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ratchet for the web scales in `libs/ui/styles/_scales.scss` (type,
 * radius, elevation, z layers). It counts the distinct literal values the
 * stylesheets still write for four properties and fails when any count grows
 * past the committed baseline. A value is literal when, with its `var()`
 * reads, Sass variables and interpolations removed, a number is left:
 * `13px`, `inset 0 0 0 1px var(--x)` and `1000` are literal;
 * `var(--app-text-sm)` and `controls.$radius-sm` are not. `0` and `none`
 * are not counted: they turn the property off rather than pick a step.
 *
 * It also enforces the type floor: no literal text size below 11px.
 *
 * The baseline only moves down: `--update` lowers it to the current counts
 * and refuses to raise it. Scales are declared in the token files, which the
 * scan skips. Inline component styles are out of scope: the web app keeps
 * its styles in `.scss` files.
 */

export const BASELINE_FILE = 'tools/nx/style-scales-baseline.json';

/** The token files: they define the scales and the theme palettes. */
export const TOKEN_FILES = new Set([
    'libs/ui/styles/_scales.scss',
    'apps/web/src/_theme-palettes.scss',
]);

const SCANNED_PATHSPECS = [
    'apps/web/*.scss',
    'apps/web/*.css',
    'libs/*.scss',
    'libs/*.css',
];

/** Each counted category and the property names that feed it. */
export const CATEGORIES = {
    fontSize: /^font-size$/,
    radius: /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/,
    zIndex: /^z-index$/,
    boxShadow: /^box-shadow$/,
};

const DECLARATION =
    /(?<![-\w$@])([a-z][a-z-]*)\s*:(?!:)\s*([^;{}]*?)\s*(?=[;}]|$)/g;

/** Drops comments without touching `//` inside a string or `url()`. */
export function stripComments(source) {
    let out = '';
    let quote = null;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            out += ch;
            if (ch === '\\') out += source[++i] ?? '';
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            out += ch;
        } else if (ch === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            const skipped = source.slice(i, end < 0 ? undefined : end + 2);
            out += skipped.replace(/[^\n]/g, ' ');
            i = end < 0 ? source.length : end + 1;
        } else if (
            ch === '/' &&
            source[i + 1] === '/' &&
            !/url\([^)]*$/.test(out.slice(-200))
        ) {
            const end = source.indexOf('\n', i);
            i = end < 0 ? source.length : end - 1;
        } else {
            out += ch;
        }
    }
    return out;
}

/** Removes `var(...)` reads, including nested parentheses. */
function withoutVarReads(value) {
    let out = '';
    for (let i = 0; i < value.length; i++) {
        if (value.startsWith('var(', i)) {
            let depth = 0;
            for (; i < value.length; i++) {
                if (value[i] === '(') depth++;
                else if (value[i] === ')' && --depth === 0) break;
            }
            out += ' ';
        } else {
            out += value[i];
        }
    }
    return out;
}

export function normalizeValue(value) {
    return value
        .replace(/!important/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\(\s+/g, '(')
        .replace(/\s+\)/g, ')')
        .trim()
        .toLowerCase();
}

export function isLiteral(value) {
    if (/^(0|none)$/.test(value)) return false;
    const rest = withoutVarReads(value)
        .replace(/#\{[^}]*\}/g, ' ')
        .replace(/(?:[a-z][\w-]*\.)?\$[\w-]+/gi, ' ');
    // A bare `0` beside tokens (`var(--r) 0 0 var(--r)`) picks no step.
    return rest
        .split(/[\s,()/]+/)
        .some((part) => /\d/.test(part) && !/^-?0$/.test(part));
}

/** Literal declarations in one stylesheet, by category. */
export function findLiterals(file, source) {
    const text = stripComments(source);
    const findings = [];
    for (const match of text.matchAll(DECLARATION)) {
        const [, property, raw] = match;
        const category = Object.keys(CATEGORIES).find((key) =>
            CATEGORIES[key].test(property)
        );
        if (!category) continue;
        const value = normalizeValue(raw);
        if (!value || !isLiteral(value)) continue;
        const line = text.slice(0, match.index).split('\n').length;
        findings.push({ file, line, category, value });
    }
    return findings;
}

/** The type floor: no text is set below 11px (`--app-text-2xs`). */
export const MIN_TEXT_PX = 11;

const SIZE_IN_VALUE = /(?<![\w.-])(\d*\.?\d+)(px|rem)\b/g;

/**
 * Literal `font-size` values, and the size in a `font` shorthand, below
 * the floor. Icon glyphs are not exempt: none sits below 11px, and a
 * smaller glyph would be unreadable too. Sizes inside `clamp()`/`max()` and
 * `em` values follow their context and are not checked.
 */
export function findUndersized(file, source) {
    const text = stripComments(source);
    const findings = [];
    for (const match of text.matchAll(DECLARATION)) {
        const [, property, raw] = match;
        if (property !== 'font-size' && property !== 'font') continue;
        const value = normalizeValue(raw);
        if (/\b(clamp|max|min|calc)\(/.test(value)) continue;
        const sizes = [...withoutVarReads(value).matchAll(SIZE_IN_VALUE)].map(
            ([, n, unit]) => (unit === 'rem' ? Number(n) * 16 : Number(n))
        );
        // A `font` shorthand's size is its first length (`600 10px/1.2 x`).
        const px =
            property === 'font'
                ? sizes[0]
                : sizes.length === 1
                  ? sizes[0]
                  : undefined;
        if (px === undefined || px >= MIN_TEXT_PX) continue;
        const line = text.slice(0, match.index).split('\n').length;
        findings.push({ file, line, value });
    }
    return findings;
}

export function countDistinct(findings) {
    const counts = {};
    for (const key of Object.keys(CATEGORIES)) {
        counts[key] = new Set(
            findings.filter((f) => f.category === key).map((f) => f.value)
        ).size;
    }
    return counts;
}

/** Categories whose count exceeds the baseline, and those now below it. */
export function compareToBaseline(counts, baseline) {
    const grown = [];
    const shrunk = [];
    for (const key of Object.keys(CATEGORIES)) {
        const allowed = baseline[key];
        if (typeof allowed !== 'number') {
            grown.push({ key, count: counts[key], allowed: 'missing' });
        } else if (counts[key] > allowed) {
            grown.push({ key, count: counts[key], allowed });
        } else if (counts[key] < allowed) {
            shrunk.push({ key, count: counts[key], allowed });
        }
    }
    return { grown, shrunk };
}

export function listScannedFiles(rootDir) {
    // No shell: see check-material-token-overrides.mjs.
    return execFileSync('git', ['ls-files', ...SCANNED_PATHSPECS], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
        .trim()
        .split('\n')
        .filter(Boolean)
        .filter((file) => !TOKEN_FILES.has(file));
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const args = new Set(process.argv.slice(2));
    const files = listScannedFiles(rootDir);
    if (files.length === 0) {
        console.error('No stylesheets matched; the scan would cover nothing.');
        process.exit(1);
    }

    const findings = [];
    const undersized = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        findings.push(...findLiterals(file, source));
        undersized.push(...findUndersized(file, source));
    }
    const counts = countDistinct(findings);

    if (undersized.length > 0) {
        console.error(
            `Text below the ${MIN_TEXT_PX}px floor. Use var(--app-text-2xs) or larger:`
        );
        for (const { file, line, value } of undersized) {
            console.error(`- ${file}:${line} ${value}`);
        }
        process.exitCode = 1;
    }

    if (args.has('--list')) {
        for (const key of Object.keys(CATEGORIES)) {
            const byValue = new Map();
            for (const f of findings.filter((x) => x.category === key)) {
                byValue.set(f.value, [...(byValue.get(f.value) ?? []), f]);
            }
            console.log(`\n${key}: ${byValue.size} distinct`);
            for (const [value, uses] of [...byValue].sort(
                (a, b) => b[1].length - a[1].length
            )) {
                console.log(`  ${String(uses.length).padStart(4)}  ${value}`);
            }
        }
    }

    const baselinePath = path.join(rootDir, BASELINE_FILE);
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    const { grown, shrunk } = compareToBaseline(counts, baseline);

    if (grown.length > 0) {
        console.error(
            'New literal style values. Use a token from libs/ui/styles/_scales.scss (--app-text-*, --app-radius-*, --app-elev-*, --app-z-*) instead:'
        );
        for (const { key, count, allowed } of grown) {
            console.error(`- ${key}: ${count} distinct (baseline ${allowed})`);
        }
        console.error('Run with --list to see every literal and its uses.');
        process.exitCode = 1;
    } else if (args.has('--update') && shrunk.length > 0) {
        await writeFile(
            baselinePath,
            `${JSON.stringify({ ...baseline, ...counts }, null, 4)}\n`
        );
        console.log(`Lowered ${BASELINE_FILE}: ${JSON.stringify(counts)}`);
    } else {
        console.log(
            `Checked ${files.length} stylesheets: ${JSON.stringify(counts)}`
        );
        if (shrunk.length > 0) {
            // A lower count must be committed, or the freed room would let
            // new literals back in unnoticed.
            console.error(
                `Counts fell below the baseline; run \`pnpm run styles:scales:update\` and commit ${BASELINE_FILE}.`
            );
            process.exitCode = 1;
        }
    }
}
