import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractStylesheetLoads } from './check-stylesheet-inputs.mjs';
import {
    blocksOf,
    calleeOf,
    codeExpression,
    insideTag,
    lex,
    lineIndex,
    placeOf,
    tokensOf,
    valueAfter,
} from './font-weight-lexer.mjs';
import { effectiveDeclarations, sassScopes } from './font-weight-scope.mjs';

/**
 * The weights `apps/web/src/styles.scss` bundles for DM Sans and its Roboto
 * fallback (JetBrains Mono stops at 500). Any other value snaps to a neighbouring face
 * (650 renders as 700), and a 600 or 700 that finds nothing heavier than 500
 * gets Chromium's synthetic bold. The workspace is at zero exceptions; this
 * check keeps it there.
 *
 * Sass is not compiled, so a weight must be written, not computed: arithmetic
 * and functions other than `var()` are findings in themselves. Variables are
 * followed by name, through `@forward … as prefix-*` too. Not traced:
 * positional mixin or function arguments and `@function` return values, so
 * pass weights as named `$…weight` arguments.
 */
export const WEIGHT_SCALE = Object.freeze([400, 500, 600, 700]);

/**
 * Not app UI: the landing site ships a variable font, so any weight is a real
 * one there.
 */
const EXCLUDED_PREFIXES = [
    'apps/website/',
    // Server-side SVG artwork in system Arial, served as images.
    'apps/xtream-mock-server/',
    'libs/shared/marketing-fixtures/',
];
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
/**
 * A static HTML or SVG presentation attribute, quoted (`font-weight="650"`,
 * also with escaped quotes inside a TypeScript string) or unquoted
 * (`font-weight=650`).
 */
const ATTRIBUTE_WEIGHT =
    /(?<![\w$-])(font-weight)\s*=\s*(?:\\?(['"])(.*?)\\?\2|([^\s>'"=<`\\]+))/gi;
/** A custom property or Sass variable that a weight value may refer to. */
const DEFINITION = /(?<![\w$-])((?:\$|--)[\w-]+)\s*:/g;
/**
 * Angular bindings (or `host`) that set a weight or a custom property:
 * `[style.font-weight]`, `[attr.font-weight]`, `[style.--title]`.
 */
const CODE_BINDING =
    /(\[(?:style|attr)\.(font-weight|fontWeight|--[\w-]+)\])['"]?\s*[:=]\s*(['"])([\s\S]*?)\3/gi;
/** DOM writes. `===` compares, so only a lone `=` (or `+=` and kin) assigns. */
const CODE_ASSIGNMENT = /(\.style\.fontWeight)\s*(\*\*|[-+*/%])?=(?!=)/g;
const CODE_SET_PROPERTY =
    /(setProperty\(\s*['"](font-weight|--[\w-]+)['"])\s*,/gi;
/**
 * Computed code: arithmetic next to a number (`600 + 50` is 650, also with a
 * signed operand as in `600 - -50`), or a minus (or a `+` before a bracket)
 * in front of a number: `-(-650)`.
 */
const CODE_ARITHMETIC =
    /\d\s*(?:\*\*|[-+*/%])\s*[-+]*\s*[\w$(.'"`]|[\w$).'"`]\s*(?:\*\*|[-+*/%])\s*[-+]*\s*\.?\d|(?:^|[^\w$).'"`\]\s])\s*(?:-\s*[\d.(]|\+\s*\()/;

/** A CSS <number>: decimals, an exponent and a `+` sign are all valid. */
const NUMBER_TEXT = String.raw`\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const NUMBER = new RegExp(
    String.raw`(?<![\w.#$-])(${NUMBER_TEXT})(?![\w.%])`,
    'gi'
);
const RELATIVE_KEYWORD = /\b(bolder|lighter)\b/gi;
/** `var(--x)`, `$x` or a module member `ns.$x`. */
const REFERENCE = /var\(\s*(--[\w-]+)|(?:([\w-]+)\.)?(\$[\w-]+)/gi;
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
    /^(?:var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)|(?:([\w-]+)\.)?(\$[\w-]+)|#\{\s*(?:([\w-]+)\.)?(\$[\w-]+)\s*\})$/i;

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
                const [, custom, fallback, ns, sass, innerNs, interpolated] =
                    variable;
                const name = identity(custom ?? sass ?? interpolated);
                const namespace = ns ?? innerNs ?? null;
                references.push({ name, namespace, mode: 'font', after: tail });
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
            name: identity(match[1] ?? match[3]),
            namespace: match[2] ?? null,
            mode: 'weight',
        })),
    };
}

/**
 * A value set from code. A string literal is CSS text and is read as such;
 * anything else is an expression, where other numbers appear too (a weight
 * is 100 or more) and arithmetic computes the value.
 */
function analyseCode(expression, mode = 'weight', after = 0) {
    const literal = /^\s*(['"`])([\s\S]*)\1\s*$/.exec(expression);
    if (literal && !literal[2].includes('${')) {
        return analyse(mode, literal[2], { after });
    }
    return analyse('weight', expression, { minimum: 100, code: true });
}

/**
 * Where each mixin or function a stylesheet defines is called in it
 * (`@include name`, `name(`), skipping the definition itself, with the
 * callable a call sits in (`within`), if any: such a call runs only when
 * that callable does.
 */
function callSitesOf(text, blocks) {
    const calls = {};
    const names = blocks
        .filter((block) => block.kind === 'callable' && block.name)
        .map((block) => block.name);
    for (const name of new Set(names)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const call = new RegExp(
            String.raw`@include\s+${escaped}(?![\w-])|(?<![\w$.-])${escaped}\s*\(`,
            'g'
        );
        calls[name] = [...text.matchAll(call)]
            .filter((match) => {
                const before = text.slice(
                    Math.max(0, match.index - 12),
                    match.index
                );
                return !/@(?:mixin|function)\s+$/.test(before);
            })
            .map(({ index }) => ({
                index,
                within: placeOf(blocks, index).callable,
            }));
    }
    return calls;
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
    const blocks = stylesheet ? blocksOf(lexed) : [];
    const record = (name, index, analysis) => {
        declarations += 1;
        for (const term of analysis.terms) {
            findings.push({ file, line: lineOf(index), name, ...term });
        }
        const { scopes, inCallable, callable } = placeOf(blocks, index);
        references.push(
            ...analysis.references.map((reference) => ({
                ...{ ...reference, file, index },
                ...{ scopes, inCallable, callable },
            }))
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
    // A weight set from code is checked here; any other custom property it
    // sets is a definition that a stylesheet's `var()` may refer to.
    const setByCode = (name, property, index, expression) => {
        if (/^font-?weight$|^--.*weight$/i.test(property)) {
            record(name, index, analyseCode(expression));
        } else if (property.startsWith('--')) {
            const line = lineOf(index);
            const value = expression;
            const key = property;
            definitions.push({
                file,
                line,
                name: property,
                key,
                value,
                code: true,
            });
        }
    };
    if (!stylesheet) {
        for (const match of text.matchAll(ATTRIBUTE_WEIGHT)) {
            // An attribute sits inside a tag; text such as
            // `<p>font-weight=750</p>` sets nothing.
            const html = file.endsWith('.html');
            if (!insideTag(lexed, match.index, { html })) continue;
            const value = match[3] ?? match[4];
            record(match[1], match.index, analyse('weight', value));
        }
        for (const match of text.matchAll(CODE_BINDING)) {
            setByCode(match[1], match[2], match.index, match[4]);
        }
        for (const match of text.matchAll(CODE_ASSIGNMENT)) {
            const end = match.index + match[0].length;
            const expression = codeExpression(text, end).trim();
            if (match[2]) {
                const value = `${match[2]}= ${expression}`;
                const terms = [{ value, computed: true }];
                record(match[1], match.index, { terms, references: [] });
            } else {
                setByCode(match[1], 'font-weight', match.index, expression);
            }
        }
        for (const match of text.matchAll(CODE_SET_PROPERTY)) {
            const end = match.index + match[0].length;
            const expression = codeExpression(text, end, { argument: true });
            const name = match[1].replace(/\s+/g, '');
            setByCode(name, match[2], match.index, expression);
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
        const index = match.index;
        // A declaration belongs to its innermost scope (see `placeOf`); a
        // `!global` one assigns the module variable, whenever it runs.
        const place = placeOf(blocks, index);
        const global = /!global\b/i.test(value);
        // `!default` assigns only while the variable is unset (see
        // `effectiveDeclarations`).
        const fallback = /!default\b/i.test(value);
        definitions.push({
            ...{ file, line, index, name, key, value, argument, fallback },
            // An argument reaches only the mixin or function it is passed to.
            callee: argument ? calleeOf(text, index) : null,
            scope: global ? null : place.scope,
            conditional: global || place.conditional,
            ...{ scopes: place.scopes, inCallable: place.inCallable },
            callable: place.callable,
        });
    }

    const loads = stylesheet ? extractStylesheetLoads(source) : [];
    const calls = callSitesOf(text, blocks);
    return {
        ...{ file, loads, declarations, findings, references, definitions },
        calls,
    };
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
    const { qualified, unqualified, imports } = sassScopes(scans);
    const callsByFile = new Map(scans.map((scan) => [scan.file, scan.calls]));
    // Whether `definition` is what `name` reads: by its own name, or for a
    // Sass member forwarded `as prefix-*`, by that prefixed name.
    const exposedAs = (definition, access, name) => {
        const prefixes = name.startsWith('$')
            ? access?.get(definition.file)?.prefixes
            : null;
        if (!prefixes) return definition.key === name;
        return [...prefixes].some(
            (prefix) =>
                identity(`$${prefix}${definition.key.slice(1)}`) === name
        );
    };
    // Whether the callable an argument is passed to is defined in `file`:
    // `ns.name(` must load `file` (or a module forwarding it) as `ns`; a bare
    // `name(` is defined in the caller itself or in what it brings in.
    const calleeReaches = ({ callee, file: caller }, file) => {
        if (callee.namespace)
            return qualified(caller, callee.namespace).has(file);
        return (
            caller === file ||
            Boolean(unqualified(caller).get(file)?.declarations)
        );
    };
    // `@import` is textual: an imported file's top-level declarations take
    // effect where the `@import` sits, transitively.
    // Each `@import` runs its file again, so only the current path guards
    // against cycles.
    // `order` keeps the text order inside the inclusion: the importer's
    // position, then each imported file's own positions.
    const imported = (file, name, prefix = [], path = new Set([file])) =>
        imports(file).flatMap(({ loaded, index }) => {
            if (path.has(loaded)) return [];
            const order = [...prefix, index];
            const position = order[0];
            const own = definitions
                .filter((d) => d.file === loaded && d.key === name)
                .filter((d) => !d.argument && d.scope === null)
                .map((d) => ({
                    ...d,
                    index: position,
                    order: [...order, d.index],
                    original: d,
                }));
            const deeper = new Set([...path, loaded]);
            return [...own, ...imported(loaded, name, order, deeper)];
        });
    // Where a callable runs: its call sites, with a call inside another
    // callable's body replaced by where that one runs.
    const runsAt = (file, name, seen = new Set()) => {
        if (!name || seen.has(name)) return [];
        seen.add(name);
        return (callsByFile.get(file)?.[name] ?? []).flatMap(
            ({ index, within }) =>
                within ? runsAt(file, within, seen) : [index]
        );
    };
    const followed = new Set();
    const findings = [];
    while (pending.length > 0) {
        const reference = pending.pop();
        const { name, mode, after = 0, file, namespace, index } = reference;
        const sass = name.startsWith('$');
        // What a Sass name resolves to depends on where it is read.
        const origin = sass ? `${file} ${namespace ?? ''} ${index}` : '';
        const key = `${mode} ${after} ${origin} ${name}`;
        if (followed.has(key)) continue;
        followed.add(key);
        const members = sass && namespace ? qualified(file, namespace) : null;
        const scope = sass && !namespace ? unqualified(file) : null;
        // A `with (…)` of this very lookup sets the name, so the module's
        // `!default` for it never applies here.
        const configuredHere = definitions.some(
            (d) =>
                d.argument &&
                d.key === name &&
                d.file === file &&
                (members ?? scope)
                    ?.get(file)
                    ?.ranges.some(([s, e]) => d.index >= s && d.index < e)
        );
        // In its own file, only the declarations in effect at the reference
        // count; other files' declarations only when those settle nothing.
        const own = scope
            ? effectiveDeclarations(
                  reference,
                  [
                      ...definitions.filter(
                          (d) =>
                              d.key === name && d.file === file && !d.argument
                      ),
                      ...imported(file, name),
                  ],
                  runsAt(file, reference.callable)
              )
            : null;
        const picked = new Set(own?.picked.map((d) => d.original ?? d));
        for (const definition of definitions) {
            if (!exposedAs(definition, members ?? scope, name)) continue;
            if (
                configuredHere &&
                definition.fallback &&
                !definition.argument &&
                definition.file !== file
            ) {
                continue;
            }
            if (sass && !definition.argument && !picked.has(definition)) {
                if (definition.file === file && !members) continue;
                // Other modules see only top-level (or `!global`) members.
                if (definition.scope !== null || own?.settled) continue;
            }
            if (members) {
                const access = members.get(definition.file);
                const visible = definition.argument
                    ? access?.ranges.some(
                          ([start, end]) =>
                              definition.index >= start &&
                              definition.index < end
                      )
                    : access?.declarations;
                if (!visible) continue;
            }
            if (scope) {
                const access = scope.get(definition.file);
                const passed =
                    definition.callee?.name === reference.callable &&
                    calleeReaches(definition, file);
                const configured = access?.ranges.some(
                    ([start, end]) =>
                        definition.index >= start && definition.index < end
                );
                // A textual importer's later code has not run when this
                // file's rules render, unless they sit in a mixin body.
                const ran =
                    reference.inCallable ||
                    definition.index < (access?.before ?? Infinity);
                const visible = definition.argument
                    ? access?.arguments && (passed || configured)
                    : access?.declarations && ran;
                if (!visible) continue;
            }
            const analysis = definition.code
                ? analyseCode(definition.value, mode, after)
                : analyse(mode, definition.value, { after });
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
                ...analysis.references.map((next) => ({
                    ...next,
                    file: definition.file,
                    index: definition.index,
                    scopes: definition.scopes,
                    inCallable: definition.inCallable,
                    callable: definition.callable,
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
