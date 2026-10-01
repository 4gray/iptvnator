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
    invocationsOf,
    lex,
    lineIndex,
    namesCallable,
    placeOf,
    resultsOf,
    tokensOf,
    valueAfter,
} from './font-weight-lexer.mjs';
import {
    MONO_FAMILY,
    MONO_WEIGHT_CAP,
    declarationText,
    familiesOf,
} from './font-weight-family.mjs';
import {
    effectiveDeclarations,
    exposedName,
    sassScopes,
} from './font-weight-scope.mjs';

/**
 * The weights `apps/web/src/styles.scss` bundles for DM Sans and its Roboto
 * fallback (JetBrains Mono stops at 500). Any other value snaps to a neighbouring face
 * (650 renders as 700), and a 600 or 700 that finds nothing heavier than 500
 * gets Chromium's synthetic bold. The workspace is at zero exceptions; this
 * check keeps it there.
 *
 * Sass is not compiled, so a weight must be written, not computed: arithmetic
 * and functions other than `var()` are findings in themselves. Variables and
 * the callables their named arguments go to are followed by name (`-` and `_`
 * alike), through `@forward … as prefix-*` and its `show`/`hide` lists too.
 * A parameter default counts where a call leaves it out, or when no call is
 * in sight. A weight set from code is read per value it can take, so a
 * condition's numbers are not weights. A partial's `!default` gives way
 * where every load of it configures the name. Not traced: positional mixin
 * or function arguments, calls through `meta.apply`, `meta.load-css` and
 * `@function` return values, so pass weights as named `$…weight` arguments.
 *
 * A stylesheet rule set in JetBrains Mono (its own `font-family` or `font`,
 * written out or through variables, or one a nested rule inherits; see
 * `familiesOf`) is capped at `MONO_WEIGHT_CAP`. A weight it inherits from
 * another rule, and a family set on an element from code, are not traced.
 */
export const WEIGHT_SCALE = Object.freeze([400, 500, 600, 700]);

export { MONO_WEIGHT_CAP };
const BOLD = /\bbold\b/gi;

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
/**
 * DOM writes, dotted or indexed (`style['font-weight']`). `===` compares, so
 * only a lone `=` (or `+=` and kin) assigns.
 */
const CODE_ASSIGNMENT =
    /(\.style(?:\.fontWeight|\[\s*(['"`])font(?:Weight|-weight)\2\s*\]))\s*(\*\*|[-+*/%])?=(?!=)/g;
const CODE_SET_PROPERTY =
    /(setProperty\(\s*['"`](font-weight|--[\w-]+)['"`])\s*,/gi;
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
function analyse(mode, value, options = {}) {
    const { minimum = 1, code = false, after = 0, cap = null } = options;
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
                references.push({
                    ...{ name, namespace, mode: 'font', after: tail },
                    cap,
                });
                const inner = analyse('font', fallback ?? '', {
                    after: tail,
                    cap,
                });
                terms.push(...inner.terms);
                references.push(...inner.references);
                return;
            }
            const previous = tokens[index - 1] ?? '';
            if (tail >= 2 && !token.includes('/') && !previous.endsWith('/')) {
                weight.push(token);
            }
        });
        const own = analyse('weight', weight.join(' '), { cap });
        return {
            terms: [...terms, ...own.terms],
            references: [...references, ...own.references],
        };
    }
    // Above `cap`, a scale weight (or `bold`, 700) gets a synthetic bold.
    const heavy = (term) =>
        cap !== null && Number(/^bold$/i.test(term) ? 700 : term) > cap;
    const numbers = [...value.matchAll(NUMBER)]
        .map((match) => match[1])
        .filter((term) => Number(term) >= minimum)
        .filter((term) => !WEIGHT_SCALE.includes(Number(term)) || heavy(term));
    const keywords = [
        ...(value.match(RELATIVE_KEYWORD) ?? []),
        ...(value.match(BOLD) ?? []).filter(heavy),
    ];
    const computed = code ? CODE_ARITHMETIC.test(value) : computedIn(value);
    return {
        terms: computed
            ? [{ value: value.trim(), computed: true }]
            : [...numbers, ...keywords].map((term) =>
                  heavy(term) ? { value: term, cap } : { value: term }
              ),
        references: [...value.matchAll(REFERENCE)].map((match) => ({
            name: identity(match[1] ?? match[3]),
            namespace: match[2] ?? null,
            mode: 'weight',
            cap,
        })),
    };
}

/**
 * A term that only the JetBrains Mono cap makes a finding: a scale weight
 * (or `bold`) above it. An off-scale one is reported as such already.
 */
function capOnly(term) {
    const offScale =
        /^[+\d.]/.test(term.value) &&
        !WEIGHT_SCALE.includes(Number(term.value));
    return Boolean(term.cap) && !offScale;
}

/**
 * A value set from code, read per result it can take (see `resultsOf`), so
 * a condition's numbers are not weights. A string literal is CSS text and is
 * read as such; anything else is an expression, where other numbers appear
 * too (a weight is 100 or more) and arithmetic computes the value.
 */
function analyseCode(expression, mode = 'weight', after = 0, cap = null) {
    const results = resultsOf(expression).map((result) => {
        const literal = /^\s*(['"`])([\s\S]*)\1\s*$/.exec(result);
        if (literal && !literal[2].includes('${')) {
            return analyse(mode, literal[2], { after, cap });
        }
        return analyse('weight', result, { minimum: 100, code: true, cap });
    });
    return {
        terms: results.flatMap((result) => result.terms),
        references: results.flatMap((result) => result.references),
    };
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
        // Sass reads `-` and `_` alike, so `heading_style` calls `heading-style`.
        const escaped = name
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/-/g, '[-_]');
        const call = new RegExp(
            String.raw`@include\s+${escaped}(?![\w-])|(?<![\w$.-])${escaped}\s*\(`,
            'g'
        );
        calls[name] = [...text.matchAll(call)]
            .filter((match) => !namesCallable(text, match.index))
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

    // The family each rule renders in (see `familiesOf`); one named through
    // variables is resolved once the whole workspace is scanned.
    const refsIn = (value, index, place) =>
        [...value.matchAll(REFERENCE)].map((match) => ({
            name: identity(match[1] ?? match[3]),
            namespace: match[2] ?? null,
            mode: 'family',
            ...{ file, index, scopes: place.scopes },
            ...{ inCallable: place.inCallable, callable: place.callable },
        }));
    const monoAt = stylesheet
        ? familiesOf(lexed, blocks, { inString, placeOf, refsIn })
        : () => ({ mono: false, refs: [] });
    // Weights in rules whose family is named through variables: capped once
    // that family resolves to JetBrains Mono.
    const deferred = [];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            if (inString(match.index)) continue;
            const name = match[1];
            const end = match.index + match[0].length;
            const { value, selector } = valueAfter(lexed, end);
            if (selector) continue;
            const mode = name.toLowerCase() === 'font' ? 'font' : 'weight';
            const family = /^font(?:-weight)?$/i.test(name)
                ? monoAt(match.index)
                : { mono: false, refs: [] };
            const cap = family.mono ? MONO_WEIGHT_CAP : null;
            record(name, match.index, analyse(mode, value, { cap }));
            if (!family.mono && family.refs.length > 0) {
                const capped = analyse(mode, value, { cap: MONO_WEIGHT_CAP });
                const place = placeOf(blocks, match.index);
                deferred.push({
                    ...{ file, line: lineOf(match.index), name },
                    refs: family.refs,
                    terms: capped.terms.filter(capOnly),
                    references: capped.references.map((reference) => ({
                        ...{ ...reference, file, index: match.index },
                        ...{ scopes: place.scopes, callable: place.callable },
                        inCallable: place.inCallable,
                    })),
                });
            }
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
            if (match[3]) {
                const value = `${match[3]}= ${expression}`;
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
        if (inString(match.index)) continue;
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
            // The whole declaration, for a family list (`a, b`).
            full: argument ? value : declarationText(lexed, end).value,
            // Checked against the scale where it is declared (see below).
            weighted: /weight$/i.test(name),
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
    const invocations = stylesheet ? invocationsOf(lexed) : [];
    return {
        ...{ file, loads, declarations, findings, references, definitions },
        ...{ calls, invocations, deferred },
    };
}

/**
 * Definitions of the variables that weight declarations refer to, read the
 * way they are used (a weight or a whole `font` shorthand) and followed
 * through chains (`--a: var(--b)`). A name ending in `weight` is already
 * checked against the scale where it is declared, so only a JetBrains Mono
 * rule's cap is new there. Custom properties cascade across the app, so
 * any definition counts; a Sass variable only what its module scope sees
 * (see `sassScopes`).
 */
export function findIndirectWeights(scans) {
    const definitions = scans.flatMap((scan) => scan.definitions);
    const pending = scans.flatMap((scan) => scan.references);
    const { qualified, unqualified, imports, loadsOf } = sassScopes(scans);
    const callsByFile = new Map(scans.map((scan) => [scan.file, scan.calls]));
    // Whether a declaration is what `name` reads, through one of the ways
    // `access` exposes its file (a `@forward` prefix, `show`/`hide`).
    const exposes = (access, definition, name) =>
        Boolean(
            access?.exposures.some(
                (exposure) => exposedName(exposure, definition.key) === name
            )
        );
    // Whether an argument sits in a `with (…)` that `access` counts and sets
    // `name` there: the names written in it read through the range's
    // exposure, or, for a loader configuring this module, the other way.
    const configures = (access, definition, name) =>
        Boolean(
            access?.ranges.some(
                ({ start, end, exposure, outward }) =>
                    definition.index >= start &&
                    definition.index < end &&
                    (outward
                        ? exposedName(exposure, name) === definition.key
                        : exposedName(exposure, definition.key) === name)
            )
        );
    // Whether an argument is passed to `callable`, defined in `file`:
    // `ns.name(` must load `file` (or a module forwarding it) as `ns`, under
    // the name it exposes `callable` by; a bare `name(` is defined in the
    // caller itself or in what it brings in.
    const passedTo = ({ callee, file: caller }, file, callable) => {
        if (!callee || !callable) return false;
        if (!callee.namespace && caller === file) {
            return callee.name === callable;
        }
        const scope = callee.namespace
            ? qualified(caller, callee.namespace)
            : unqualified(caller);
        const access = scope.get(file);
        return (
            Boolean(access?.declarations) &&
            access.exposures.some(
                (exposure) => exposedName(exposure, callable) === callee.name
            )
        );
    };
    // A parameter default is the value only at calls that leave it out. A
    // callable with no call in sight may be called from where the scan
    // cannot see, so its defaults count.
    const invocations = scans.flatMap(({ file, invocations: calls = [] }) =>
        calls.map((call) => ({ ...call, file }))
    );
    const defaultUsed = new Map();
    const usesDefault = (definition) => {
        if (defaultUsed.has(definition)) return defaultUsed.get(definition);
        const callable = definition.callee.name;
        const calls = invocations.filter(
            (call) =>
                call.callee.name.endsWith(callable) &&
                passedTo(call, definition.file, callable)
        );
        const names = (call) =>
            definitions.some(
                (d) =>
                    d.argument &&
                    d.file === call.file &&
                    d.callee?.paren === call.paren &&
                    d.key === definition.key
            );
        const used = calls.length === 0 || calls.some((call) => !names(call));
        defaultUsed.set(definition, used);
        return used;
    };
    // A partial runs only where it is loaded, so its `!default` for a name
    // never applies when every load sets that name (not to `null`), in its
    // own `with (…)` or, through a `@forward`, in the forwarding module's
    // loads under the prefix. A file that is not a partial may be compiled
    // on its own, unconfigured.
    const configuredCache = new Map();
    const alwaysConfigured = (file, name, chain = new Set()) => {
        const cacheKey = `${file} ${name}`;
        if (chain.size === 0 && configuredCache.has(cacheKey)) {
            return configuredCache.get(cacheKey);
        }
        const partial = /^_/.test(path.posix.basename(file));
        if (!partial || chain.has(file)) return false;
        const loads = loadsOf(file);
        const deeper = new Set([...chain, file]);
        const sets = (load) =>
            definitions.some(
                (d) =>
                    d.argument &&
                    d.file === load.file &&
                    d.key === name &&
                    !/^null\b/i.test(d.value.trim()) &&
                    load.ranges.some(([s, e]) => d.index >= s && d.index < e)
            );
        const configured =
            loads.length > 0 &&
            loads.every(
                (load) =>
                    sets(load) ||
                    (load.forward &&
                        alwaysConfigured(
                            load.file,
                            exposedName(
                                { prefix: load.prefix, filters: [] },
                                name
                            ),
                            deeper
                        ))
            );
        if (chain.size === 0) configuredCache.set(cacheKey, configured);
        return configured;
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
    // The definitions a reference can resolve to, as Sass and the cascade
    // read them (see `sassScopes` and `effectiveDeclarations`).
    const visibleDefinitions = (reference) => {
        const { name, file, namespace } = reference;
        const sass = name.startsWith('$');
        const members = sass && namespace ? qualified(file, namespace) : null;
        const scope = sass && !namespace ? unqualified(file) : null;
        // A `with (…)` of this very lookup sets the name, so the module's
        // `!default` for it never applies here.
        // `null` counts as unset, so the `!default` still applies.
        const configuredHere = definitions.some(
            (d) =>
                d.argument &&
                d.file === file &&
                !/^null\b/i.test(d.value.trim()) &&
                configures((members ?? scope)?.get(file), d, name)
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
        return definitions.filter((definition) => {
            const access = (members ?? scope)?.get(definition.file);
            if (!sass && definition.key !== name) return false;
            // An argument's name is matched where it is passed, below.
            if (sass && !definition.argument) {
                if (!exposes(access, definition, name)) return false;
            }
            if (
                configuredHere &&
                definition.fallback &&
                !definition.argument &&
                definition.file !== file
            ) {
                return false;
            }
            if (
                sass &&
                definition.fallback &&
                !definition.argument &&
                definition.scope === null &&
                alwaysConfigured(definition.file, definition.key)
            ) {
                return false;
            }
            if (sass && !definition.argument && !picked.has(definition)) {
                if (definition.file === file && !members) return false;
                // Other modules see only top-level (or `!global`) members.
                if (definition.scope !== null || own?.settled) return false;
            }
            if (members) {
                const visible = definition.argument
                    ? configures(access, definition, name)
                    : access?.declarations;
                if (!visible) return false;
            }
            if (scope) {
                const passed =
                    definition.key === name &&
                    passedTo(definition, file, reference.callable) &&
                    (!definition.callee.signature || usesDefault(definition));
                const configured = configures(access, definition, name);
                // A textual importer's later code has not run when this
                // file's rules render, unless they sit in a mixin body.
                const ran =
                    reference.inCallable ||
                    definition.index < (access?.before ?? Infinity);
                const visible = definition.argument
                    ? access?.arguments && (passed || configured)
                    : access?.declarations && ran;
                if (!visible) return false;
            }
            return true;
        });
    };
    // Whether a family reference names JetBrains Mono, through chains.
    const namesMono = (reference, seen = new Set()) => {
        const { name, file, namespace, index } = reference;
        const key = `${file} ${namespace ?? ''} ${index} ${name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return visibleDefinitions(reference).some((definition) => {
            const text = definition.full ?? definition.value;
            if (MONO_FAMILY.test(text)) return true;
            return [...text.matchAll(REFERENCE)].some((match) =>
                namesMono(
                    {
                        name: identity(match[1] ?? match[3]),
                        namespace: match[2] ?? null,
                        file: definition.file,
                        index: definition.index,
                        scopes: definition.scopes,
                        inCallable: definition.inCallable,
                        callable: definition.callable,
                    },
                    seen
                )
            );
        });
    };
    const followed = new Set();
    const findings = [];
    for (const candidate of scans.flatMap((scan) => scan.deferred ?? [])) {
        if (!candidate.refs.some((reference) => namesMono(reference))) continue;
        const { file, line, name } = candidate;
        findings.push(
            ...candidate.terms.map((term) => ({ file, line, name, ...term }))
        );
        pending.push(...candidate.references);
    }
    while (pending.length > 0) {
        const reference = pending.pop();
        const { name, mode, after = 0, file, namespace, index } = reference;
        const { cap = null } = reference;
        const sass = name.startsWith('$');
        // What a Sass name resolves to depends on where it is read.
        const origin = sass ? `${file} ${namespace ?? ''} ${index}` : '';
        const key = `${mode} ${after} ${cap} ${origin} ${name}`;
        if (followed.has(key)) continue;
        followed.add(key);
        for (const definition of visibleDefinitions(reference)) {
            const analysis = definition.code
                ? analyseCode(definition.value, mode, after, cap)
                : analyse(mode, definition.value, { after, cap });
            const terms = definition.weighted
                ? analysis.terms.filter(capOnly)
                : analysis.terms;
            for (const term of terms) {
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

export function describeFinding(finding) {
    const { file, line, name, value, computed, cap } = finding;
    const scale = WEIGHT_SCALE.join('/');
    if (cap && !computed) {
        return `${file}:${line} ${name}: ${value} is heavier than ${cap}, the heaviest JetBrains Mono face bundled, and a JetBrains Mono rule uses it, so Chromium fakes the bold. Use ${cap}.`;
    }
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
            `Checked ${declarations} weight declarations across ${files.length} files; every weight is on the ${WEIGHT_SCALE.join('/')} scale and JetBrains Mono rules stay at ${MONO_WEIGHT_CAP} or lighter.`
        );
    }
}
