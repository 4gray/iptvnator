import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The weights `apps/web/src/styles.scss` bundles for DM Sans, its Roboto
 * fallback and JetBrains Mono. Any other value snaps to a neighbouring face
 * (650 renders as 700), and a 600 or 700 that finds nothing heavier than 500
 * gets Chromium's synthetic bold. The workspace is at zero exceptions; this
 * check keeps it there.
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
/** A custom property or Sass variable that a weight value may refer to. */
const DEFINITION = /(?<![\w$-])((?:\$|--)[\w-]+)\s*:/g;
/**
 * Weights set from code: Angular `[style.font-weight]` bindings (template or
 * `host`) and literal DOM writes. The expression is the second capture.
 */
const CODE_WEIGHT = [
    /(\[style\.(?:font-weight|fontWeight)\])['"]?\s*[:=]\s*(['"])(.*?)\2/g,
    /(\.style\.fontWeight)\s*=\s*(['"`]?)([\w.+-]*)\2/g,
    /(setProperty\(\s*['"]font-weight['"])\s*,\s*(['"`]?)([\w.+-]*)\2/g,
];

/** A CSS <number>: decimals, an exponent and a `+` sign are all valid. */
const NUMBER_TEXT = String.raw`\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const NUMBER = new RegExp(
    String.raw`(?<![\w.#$-])(${NUMBER_TEXT})(?![\w.%])`,
    'gi'
);
const RELATIVE_KEYWORD = /\b(bolder|lighter)\b/g;
const REFERENCE = /var\(\s*(--[\w-]+)|(\$[\w-]+)/g;
const VALUE_END = new Set([';', '{', '}', "'", '"', '`', ']']);

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
    for (; end < source.length; end += 1) {
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

/** Whitespace-separated tokens, keeping `var(--x, 650)` in one piece. */
function tokensOf(value) {
    const tokens = [];
    let depth = 0;
    let current = '';
    for (const char of value.trim()) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (depth === 0 && /\s/.test(char)) {
            if (current) tokens.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    if (current) tokens.push(current);
    return tokens;
}

/**
 * The parts of a value that can set a weight. In the `font` shorthand a weight
 * comes before the size and the family, so only tokens with two more after
 * them count, never the line height after `/`. A TypeScript `font: 12`
 * property is therefore not read as a weight.
 */
function weightText(name, value) {
    if (name !== 'font') return value;
    const tokens = tokensOf(value);
    return tokens
        .filter((token, index) => {
            const previous = tokens[index - 1] ?? '';
            return index < tokens.length - 2 && !previous.endsWith('/');
        })
        .join(' ');
}

/** Numbers off the scale and relative keywords, as written. */
function offScaleTerms(text, minimum = 0) {
    const numbers = [...text.matchAll(NUMBER)]
        .map((match) => match[1])
        .filter((term) => Number(term) >= minimum)
        .filter((term) => !WEIGHT_SCALE.includes(Number(term)));
    return [...numbers, ...(text.match(RELATIVE_KEYWORD) ?? [])];
}

function referencesIn(text) {
    return [...text.matchAll(REFERENCE)].map((match) => match[1] ?? match[2]);
}

/**
 * One file's weight declarations: off-scale findings, the custom properties
 * and Sass variables its weights refer to, and every such variable it defines
 * (checked later, once the whole workspace has named what it refers to).
 */
export function scanWeights(file, source) {
    const stripped = blankComments(source);
    const stylesheet = STYLESHEET.test(file);
    const patterns = stylesheet
        ? [STYLESHEET_WEIGHT, FONT_SHORTHAND]
        : [SOURCE_WEIGHT, FONT_SHORTHAND];
    const findings = [];
    const references = new Set();
    const definitions = [];
    let declarations = 0;
    const record = (name, index, text, minimum) => {
        const line = lineOf(stripped, index);
        declarations += 1;
        for (const value of offScaleTerms(text, minimum)) {
            findings.push({ file, line, name, value });
        }
        for (const reference of referencesIn(text)) references.add(reference);
    };

    for (const pattern of patterns) {
        for (const match of stripped.matchAll(pattern)) {
            const name = match[1];
            const end = match.index + match[0].length;
            const { value, selector } = valueAfter(stripped, end);
            if (!selector) record(name, match.index, weightText(name, value));
        }
    }
    if (!stylesheet) {
        // Code expressions carry other numbers too; a weight is 100 or more.
        for (const pattern of CODE_WEIGHT) {
            for (const match of stripped.matchAll(pattern)) {
                record(match[1], match.index, match[3], 100);
            }
        }
    }
    for (const match of stripped.matchAll(DEFINITION)) {
        const name = match[1];
        if (/weight$/i.test(name) || (!stylesheet && name.startsWith('$'))) {
            continue;
        }
        const { value, selector } = valueAfter(
            stripped,
            match.index + match[0].length
        );
        if (selector) continue;
        definitions.push({
            file,
            line: lineOf(stripped, match.index),
            name,
            value,
        });
    }

    return { declarations, findings, references, definitions };
}

/**
 * Definitions of the variables that weight declarations refer to, followed
 * through chains (`--a: var(--b)`). A name ending in `weight` is already
 * checked where it is declared.
 */
export function findIndirectWeights(scans) {
    const definitions = scans.flatMap((scan) => scan.definitions);
    const pending = scans.flatMap((scan) => [...scan.references]);
    const followed = new Set();
    const findings = [];
    while (pending.length > 0) {
        const name = pending.pop();
        if (followed.has(name)) continue;
        followed.add(name);
        for (const definition of definitions) {
            if (definition.name !== name) continue;
            const { file, line, value } = definition;
            for (const term of offScaleTerms(value)) {
                findings.push({ file, line, name, value: term });
            }
            pending.push(...referencesIn(value));
        }
    }
    return findings;
}

/** Every off-scale weight one file can reach on its own. */
export function findOffScaleWeights(file, source) {
    const scan = scanWeights(file, source);
    return {
        declarations: scan.declarations,
        findings: [...scan.findings, ...findIndirectWeights([scan])],
    };
}

export function describeFinding({ file, line, name, value }) {
    const scale = WEIGHT_SCALE.join('/');
    if (/^(bolder|lighter)$/.test(String(value))) {
        return `${file}:${line} ${name}: ${value} is relative to the parent weight and can land off the ${scale} scale. Use an explicit scale weight.`;
    }
    return `${file}:${line} ${name}: ${value} is off the ${scale} scale, so the bundled faces render it as a neighbouring weight or a synthetic bold. Use ${nearestScaleWeight(Number(value))}.`;
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

    const scans = [];
    for (const file of files) {
        const source = await readFile(path.resolve(rootDir, file), 'utf8');
        scans.push(scanWeights(file, source));
    }
    const findings = [
        ...scans.flatMap((scan) => scan.findings),
        ...findIndirectWeights(scans),
    ];
    const diagnostics = [
        ...validateScanCoverage(files),
        ...findings.map(describeFinding),
    ];
    const declarations = scans.reduce(
        (sum, scan) => sum + scan.declarations,
        0
    );

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
