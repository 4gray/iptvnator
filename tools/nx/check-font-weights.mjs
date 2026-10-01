import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The weights `apps/web/src/styles.scss` bundles for DM Sans and its Roboto
 * fallback. Any other value snaps to a neighbouring face: 650 renders as 700
 * once a 700 face is loaded, and a weight above the heaviest face is faked by
 * Chromium's synthetic bold. The workspace is at zero exceptions; this check
 * keeps it there.
 */
export const WEIGHT_SCALE = Object.freeze([400, 500, 600, 700]);

/** The landing site ships a variable font, so any weight is a real one there. */
const EXCLUDED_PREFIXES = ['apps/website/'];
const STYLESHEET = /\.(s?css)$/;
const SOURCE = /\.(ts|html)$/;

/**
 * Stylesheets feed weights through `font-weight`, custom properties, Sass
 * variables and Material token maps, so any name ending in `weight` counts.
 * In TypeScript and HTML only CSS text is in scope, never a variable that
 * happens to be called `…Weight`.
 */
const STYLESHEET_WEIGHT = /(?<![\w$-])((?:\$|--)?[\w-]*weight)\s*:/gi;
const SOURCE_WEIGHT =
    /(?<![\w$-])(font-weight|fontWeight|--[\w-]*weight)['"]?\s*:/g;
const FONT_SHORTHAND = /(?<![\w$-])(font)\s*:/g;
/** A bare integer: not part of a name, a decimal, a hex colour or a unit. */
const BARE_INTEGER = /(?<![\w.#-])(\d+)(?![\w.%])/g;
const RELATIVE_KEYWORD = /\b(bolder|lighter)\b/;

export function isScannedFile(file) {
    const normalized = file.split(path.sep).join('/');
    if (!/^(apps|libs)\//.test(normalized)) return false;
    if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
        return false;
    }
    return STYLESHEET.test(normalized) || SOURCE.test(normalized);
}

/**
 * Blanks comments but keeps every newline, so reported line numbers match the
 * file. `//` after a colon is a protocol (`https://`), not a comment.
 */
export function blankComments(source) {
    const blank = (text) => text.replace(/[^\n]/g, ' ');
    return source
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/<!--[\s\S]*?-->/g, blank)
        .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, lead, comment) => {
            return lead + blank(comment);
        });
}

const VALUE_END = new Set([';', '{', '}', "'", '"', '`', ']']);
const VALUE_LIMIT = 400;

/**
 * The declaration's value, across line breaks, so a wrapped
 * `var(--x,\n    650)` keeps its fallback. It ends at `;`, a brace, a quote
 * (the end of an inline style string), or, outside parentheses, at a comma or
 * the `)` that closes a Sass map or argument list. A `{` first means the match
 * was a selector such as `.x-weight:hover`.
 */
function valueAfter(source, start) {
    let depth = 0;
    let end = start;
    for (; end < source.length && end - start < VALUE_LIMIT; end += 1) {
        const char = source[end];
        if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            if (depth === 0) break;
            depth -= 1;
        } else if (VALUE_END.has(char) || (char === ',' && depth === 0)) {
            break;
        }
    }
    return { value: source.slice(start, end), selector: source[end] === '{' };
}

function lineOf(source, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) if (source[i] === '\n') line += 1;
    return line;
}

/** Scale step to use instead: rounds down between 600 and 700 (620–680). */
export function nearestScaleWeight(weight) {
    if (weight < 450) return 400;
    if (weight < 550) return 500;
    if (weight < 700) return 600;
    return 700;
}

/**
 * In the `font` shorthand a weight can only come before the size, so an
 * integer counts when a token follows it and it is not the line height after
 * `/`. A TypeScript `font: 12` property is therefore not read as a weight.
 */
function shorthandWeights(value) {
    const tokens = value.trim().split(/\s+/);
    return tokens
        .filter((token, index) => {
            const previous = tokens[index - 1] ?? '';
            return (
                /^\d+$/.test(token) &&
                index < tokens.length - 1 &&
                !previous.endsWith('/')
            );
        })
        .map(Number);
}

function weightsIn(name, value) {
    if (name === 'font') return shorthandWeights(value);
    return [...value.matchAll(BARE_INTEGER)].map((match) => Number(match[1]));
}

/** Every weight declaration in one file that is off the scale. */
export function findOffScaleWeights(file, source) {
    const stripped = blankComments(source);
    const patterns = STYLESHEET.test(file)
        ? [STYLESHEET_WEIGHT, FONT_SHORTHAND]
        : [SOURCE_WEIGHT, FONT_SHORTHAND];
    const findings = [];
    let declarations = 0;

    for (const pattern of patterns) {
        for (const match of stripped.matchAll(pattern)) {
            const name = match[1];
            const { value, selector } = valueAfter(
                stripped,
                match.index + match[0].length
            );
            if (selector) continue;
            const line = lineOf(stripped, match.index);
            declarations += 1;
            const keyword = value.match(RELATIVE_KEYWORD);
            if (keyword && name !== 'font') {
                findings.push({ file, line, name, value: keyword[1] });
            }
            for (const weight of weightsIn(name, value)) {
                if (!WEIGHT_SCALE.includes(weight)) {
                    findings.push({ file, line, name, value: weight });
                }
            }
        }
    }

    return { declarations, findings };
}

export function describeFinding({ file, line, name, value }) {
    const scale = WEIGHT_SCALE.join('/');
    if (typeof value === 'string') {
        return `${file}:${line} ${name}: ${value} is relative to the parent weight and can land off the ${scale} scale. Use an explicit scale weight.`;
    }
    return `${file}:${line} ${name}: ${value} is off the ${scale} scale, so the bundled faces render it as a neighbouring weight or a synthetic bold. Use ${nearestScaleWeight(value)}.`;
}

/**
 * A check that scanned nothing must never report success: the workspace always
 * contains stylesheets, so an empty listing means the file scan broke.
 */
export function validateScanCoverage(files) {
    if (files.some((file) => STYLESHEET.test(file))) return [];
    return [
        'No stylesheets were scanned. The workspace always contains SCSS, so an empty listing means the file scan failed rather than that the policy passed.',
    ];
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    // No shell and no quoted pathspec: `cmd.exe` would pass quotes literally.
    const files = execFileSync('git', ['ls-files', '--', 'apps', 'libs'], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    })
        .split('\n')
        .filter(Boolean)
        .filter(isScannedFile);

    let declarations = 0;
    const diagnostics = validateScanCoverage(files);
    for (const file of files) {
        const source = await readFile(path.resolve(rootDir, file), 'utf8');
        const result = findOffScaleWeights(file, source);
        declarations += result.declarations;
        diagnostics.push(...result.findings.map(describeFinding));
    }

    if (diagnostics.length > 0) {
        console.error('Font weight scale check failed:');
        for (const diagnostic of diagnostics) console.error(`- ${diagnostic}`);
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${declarations} weight declarations across ${files.length} files; every weight is on the ${WEIGHT_SCALE.join('/')} scale.`
        );
    }
}
