import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractStylesheetLoads } from './check-stylesheet-inputs.mjs';
import {
    codeExpression,
    lex,
    lineIndex,
    tokensOf,
    valueAfter,
} from './font-weight-lexer.mjs';
import { sassScopes } from './font-weight-scope.mjs';

/**
 * The weights `apps/web/src/styles.scss` bundles for DM Sans, its Roboto
 * fallback and JetBrains Mono. Any other value snaps to a neighbouring face
 * (650 renders as 700), and a 600 or 700 that finds nothing heavier than 500
 * gets Chromium's synthetic bold. The workspace is at zero exceptions; this
 * check keeps it there.
 *
 * Sass is not compiled, so a weight must be written, not computed: arithmetic
 * and functions other than `var()` are findings in themselves. Variables are
 * followed by name. Not traced: positional mixin or function arguments and
 * `@function` return values, so pass weights as named `$…weight` arguments.
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
 * happens to be called `…Weight`. CSS names, keywords and functions are
 * case-insensitive, so every pattern below that matches CSS text is too.
 */
const STYLESHEET_WEIGHT = /(?<![\w$-])((?:\$|--)?[\w-]*weight)\s*:/gi;
const SOURCE_WEIGHT =
    /(?<![\w$-])(font-weight|fontWeight|--[\w-]*weight)['"]?\s*:/gi;
const FONT_SHORTHAND = /(?<![\w$-])(font)\s*:/gi;
/** A custom property or Sass variable that a weight value may refer to. */
const DEFINITION = /(?<![\w$-])((?:\$|--)[\w-]+)\s*:/g;
/** Angular `[style.font-weight]` bindings, in a template or `host`. */
const CODE_BINDING =
    /(\[style\.(?:font-weight|fontWeight)\])['"]?\s*[:=]\s*(['"])([\s\S]*?)\2/g;
/** DOM writes. `===` compares, so only a lone `=` (or `+=` and kin) assigns. */
const CODE_ASSIGNMENT = /(\.style\.fontWeight)\s*(\*\*|[-+*/%])?=(?!=)/g;
const CODE_SET_PROPERTY = /(setProperty\(\s*['"]font-weight['"])\s*,/gi;
/** Arithmetic next to a number in code: `600 + 50` is 650 at runtime. */
const CODE_ARITHMETIC =
    /\d\s*(?:\*\*|[-+*/%])\s*[\w$(.'"`]|[\w$).'"`]\s*(?:\*\*|[-+*/%])\s*\.?\d/;

/** A CSS <number>: decimals, an exponent and a `+` sign are all valid. */
const NUMBER_TEXT = String.raw`\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const NUMBER = new RegExp(
    String.raw`(?<![\w.#$-])(${NUMBER_TEXT})(?![\w.%])`,
    'gi'
);
const RELATIVE_KEYWORD = /\b(bolder|lighter)\b/gi;
const REFERENCE = /var\(\s*(--[\w-]+)|(\$[\w-]+)/gi;
/**
 * One token of a weight expression: a number (with any unit), an identifier
 * (opening a call when `(` follows), an operator or a parenthesis.
 */
const EXPRESSION_TOKEN =
    /\s*(?:((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[a-z%]*)|([$-]*[a-z_][\w-]*(?:\.[$\w-]+)*)(\()?|([-+*/%])|([()]))/giy;
/**
 * A shorthand token that is one variable: `var(--x)` (with an optional
 * fallback), `$x` or an interpolated `#{$x}`.
 */
const VARIABLE_TOKEN =
    /^(?:var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)|(\$[\w-]+)|#\{\s*(\$[\w-]+)\s*\})$/i;

export function isScannedFile(file) {
    const normalized = file.split(path.sep).join('/');
    if (!/^(apps|libs)\//.test(normalized)) return false;
    if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
        return false;
    }
    return STYLESHEET.test(normalized) || SOURCE.test(normalized);
}

/** Comments blanked, newlines kept, so reported line numbers match the file. */
export function blankComments(source, file = 'source.scss') {
    return lex(file, source).text;
}

/** Scale step to use instead: rounds down between 600 and 700 (620–680). */
export function nearestScaleWeight(weight) {
    if (weight < 450) return 400;
    if (weight < 550) return 500;
    if (weight < 700) return 600;
    return 700;
}

/** Sass treats `-` and `_` in a name alike; custom properties are exact. */
function identity(name) {
    return name.startsWith('$') ? name.replace(/_/g, '-') : name;
}

/**
 * Sass arithmetic and functions compile to a value the source does not show
 * (`400 + 500` is 900, `-(-650)` is 650), so a CSS weight that uses them is
 * reported whole. The one sign that is part of a number is a `+` written
 * directly before it (`+700`). TypeScript `${…}` holds code, whose numbers
 * are checked as terms instead.
 */
function computedIn(value) {
    const css = value.replace(/\$\{[^}]*\}/g, ' 0 ');
    let previous = '';
    EXPRESSION_TOKEN.lastIndex = 0;
    while (EXPRESSION_TOKEN.lastIndex < css.length) {
        const start = EXPRESSION_TOKEN.lastIndex;
        const match = EXPRESSION_TOKEN.exec(css);
        if (!match) {
            EXPRESSION_TOKEN.lastIndex = start + 1;
            previous = '';
            continue;
        }
        const [, number, identifier, call, operator, paren] = match;
        if (call && identifier.toLowerCase() !== 'var') return true;
        // `+700` is a number; any other sign or operator computes a value.
        const signed =
            operator === '+' &&
            previous !== 'operand' &&
            /^[\d.]/.test(css.slice(EXPRESSION_TOKEN.lastIndex));
        if (operator && !signed) return true;
        previous =
            !call && (number || identifier || paren === ')') ? 'operand' : '';
    }
    return false;
}

/**
 * What a value contributes to a weight: off-scale terms as written, and the
 * variables to follow. `font` reads the value as the shorthand, whose weight
 * comes before the size and the family: a token counts only with two more
 * after it (so a TypeScript `font: 12` property is not a weight), and never
 * the size with its `/line-height` or what follows a `/`. A variable token
 * may stand for any stretch of the shorthand (`font: italic $body`), so it is
 * followed as shorthand, carrying how many tokens come after it (`after`).
 * A weight is 1 to 1000, so `0`, the one unitless font size, is never one.
 */
function analyse(mode, value, { minimum = 1, code = false, after = 0 } = {}) {
    if (mode === 'font') {
        const tokens = tokensOf(value);
        const weight = [];
        const terms = [];
        const references = [];
        tokens.forEach((token, index) => {
            // Only "two or more after" matters; capping keeps cycles finite.
            const tail = Math.min(tokens.length - 1 - index + after, 2);
            const variable = VARIABLE_TOKEN.exec(token);
            if (variable) {
                const [, custom, fallback, sass, interpolated] = variable;
                const name = identity(custom ?? sass ?? interpolated);
                references.push({ name, mode: 'font', after: tail });
                const inner = analyse('font', fallback ?? '', { after: tail });
                terms.push(...inner.terms);
                references.push(...inner.references);
                return;
            }
            const previous = tokens[index - 1] ?? '';
            if (tail >= 2 && !token.includes('/') && !previous.endsWith('/')) {
                weight.push(token);
            }
        });
        const own = analyse('weight', weight.join(' '));
        return {
            terms: [...terms, ...own.terms],
            references: [...references, ...own.references],
        };
    }
    const numbers = [...value.matchAll(NUMBER)]
        .map((match) => match[1])
        .filter((term) => Number(term) >= minimum)
        .filter((term) => !WEIGHT_SCALE.includes(Number(term)));
    const computed = code ? CODE_ARITHMETIC.test(value) : computedIn(value);
    return {
        terms: computed
            ? [{ value: value.trim(), computed: true }]
            : [...numbers, ...(value.match(RELATIVE_KEYWORD) ?? [])].map(
                  (term) => ({ value: term })
              ),
        references: [...value.matchAll(REFERENCE)].map((match) => ({
            name: identity(match[1] ?? match[2]),
            mode: 'weight',
        })),
    };
}

/**
 * One file's weight declarations: off-scale findings, the custom properties
 * and Sass variables its weights refer to, and every such variable it defines
 * (checked later, once the whole workspace has named what it refers to).
 */
export function scanWeights(file, source) {
    const lexed = lex(file, source);
    const { text, quoteAt } = lexed;
    const lineOf = lineIndex(text);
    const stylesheet = STYLESHEET.test(file);
    const patterns = stylesheet
        ? [STYLESHEET_WEIGHT, FONT_SHORTHAND]
        : [SOURCE_WEIGHT, FONT_SHORTHAND];
    // In a stylesheet a string is content (`content: "…"`), never a rule.
    const inString = (index) => stylesheet && quoteAt[index] !== '';
    const findings = [];
    const references = [];
    const definitions = [];
    let declarations = 0;
    const record = (name, index, analysis) => {
        declarations += 1;
        for (const term of analysis.terms) {
            findings.push({ file, line: lineOf(index), name, ...term });
        }
        references.push(
            ...analysis.references.map((reference) => ({ ...reference, file }))
        );
    };

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            if (inString(match.index)) continue;
            const name = match[1];
            const end = match.index + match[0].length;
            const { value, selector } = valueAfter(lexed, end);
            const mode = name.toLowerCase() === 'font' ? 'font' : 'weight';
            if (!selector) record(name, match.index, analyse(mode, value));
        }
    }
    if (!stylesheet) {
        // Code expressions carry other numbers too; a weight is 100 or more.
        const code = { minimum: 100, code: true };
        for (const match of text.matchAll(CODE_BINDING)) {
            record(match[1], match.index, analyse('weight', match[3], code));
        }
        for (const match of text.matchAll(CODE_ASSIGNMENT)) {
            const end = match.index + match[0].length;
            const expression = codeExpression(text, end).trim();
            const analysis = match[2]
                ? {
                      terms: [
                          {
                              value: `${match[2]}= ${expression}`,
                              computed: true,
                          },
                      ],
                      references: [],
                  }
                : analyse('weight', expression, code);
            record(match[1], match.index, analysis);
        }
        for (const match of text.matchAll(CODE_SET_PROPERTY)) {
            const end = match.index + match[0].length;
            const expression = codeExpression(text, end, { argument: true });
            const name = match[1].replace(/\s+/g, '');
            record(name, match.index, analyse('weight', expression, code));
        }
    }
    for (const match of text.matchAll(DEFINITION)) {
        const name = match[1];
        if (inString(match.index) || /weight$/i.test(name)) continue;
        if (!stylesheet && name.startsWith('$')) continue;
        const end = match.index + match[0].length;
        const { value, selector } = valueAfter(lexed, end);
        if (selector) continue;
        // `$x: 1` right after `(` or `,` is an argument (a mixin call, a
        // `with (…)` configuration); otherwise it declares the variable.
        let before = match.index - 1;
        while (before >= 0 && /\s/.test(text[before])) before -= 1;
        const argument = text[before] === '(' || text[before] === ',';
        const line = lineOf(match.index);
        const key = identity(name);
        definitions.push({ file, line, name, key, value, argument });
    }

    const loads = stylesheet ? extractStylesheetLoads(source) : [];
    return { file, loads, declarations, findings, references, definitions };
}

/**
 * Definitions of the variables that weight declarations refer to, read the
 * way they are used (a weight or a whole `font` shorthand) and followed
 * through chains (`--a: var(--b)`). A name ending in `weight` is already
 * checked where it is declared. Custom properties cascade across the app, so
 * any definition counts; a Sass variable only what its module scope sees
 * (see `sassScopes`).
 */
export function findIndirectWeights(scans) {
    const definitions = scans.flatMap((scan) => scan.definitions);
    const pending = scans.flatMap((scan) => scan.references);
    const scopeOf = sassScopes(scans);
    const followed = new Set();
    const findings = [];
    while (pending.length > 0) {
        const { name, mode, after = 0, file } = pending.pop();
        const sass = name.startsWith('$');
        const key = `${mode} ${after} ${sass ? file : ''} ${name}`;
        if (followed.has(key)) continue;
        followed.add(key);
        for (const definition of definitions) {
            if (definition.key !== name) continue;
            if (sass) {
                const access = scopeOf(file).get(definition.file);
                const visible = definition.argument
                    ? access?.arguments
                    : access?.declarations;
                if (!visible) continue;
            }
            const analysis = analyse(mode, definition.value, { after });
            for (const term of analysis.terms) {
                const { line } = definition;
                const at = {
                    file: definition.file,
                    line,
                    name: definition.name,
                };
                findings.push({ ...at, ...term });
            }
            pending.push(
                ...analysis.references.map((reference) => ({
                    ...reference,
                    file: definition.file,
                }))
            );
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

export function describeFinding({ file, line, name, value, computed }) {
    const scale = WEIGHT_SCALE.join('/');
    if (computed) {
        return `${file}:${line} ${name}: ${value} is computed, and the compiled value is what renders (Sass turns \`400 + 500\` into 900). Write a ${scale} weight.`;
    }
    if (/^(bolder|lighter)$/i.test(String(value))) {
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
