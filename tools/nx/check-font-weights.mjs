import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractStylesheetLoads } from './check-stylesheet-inputs.mjs';
import {
    blocksOf,
    calleeOf,
    closingBrace,
    codeExpression,
    codeStringAt,
    concatenatedAfter,
    decodeSource,
    inBinding,
    inConditionPrelude,
    inMarkupCss,
    inUnquotedStyle,
    insideTag,
    invocationsOf,
    lex,
    lineIndex,
    namesCallable,
    placeOf,
    resultsOf,
    templateParts,
    tokensOf,
    valueAfter,
} from './font-weight-lexer.mjs';
import {
    ALL_RESET,
    IMPORTANT,
    startsDeclaration,
    MONO_WEIGHT_CAP,
    canonicalSelector,
    declarationText,
    atRootExcludes,
    blockKind,
    familiesOf,
    entryVerdict,
    familyEntries,
    familyParts,
    fontNamespaceRule,
    hasLiteralSize,
    parsesAsFont,
    keyOrder,
    levelOf,
    plainHost,
    reachDepth,
    selectorList,
    reachesEverything,
    rendersMono,
    shorthandFamilies,
} from './font-weight-family.mjs';
import {
    effectiveDeclarations,
    exposedName,
    sassScopes,
} from './font-weight-scope.mjs';

/**
 * The weights `apps/web/src/styles.scss` bundles for DM Sans and its Roboto
 * fallback (JetBrains Mono stops at 500). Any other value snaps to a
 * neighbouring face (650 renders as 700), and a 600 or 700 that finds
 * nothing heavier than 500 gets Chromium's synthetic bold. The workspace is
 * at zero exceptions; this check keeps it there.
 *
 * Sass is not compiled, so a weight must be written, not computed: arithmetic
 * and functions other than `var()` are findings in themselves. Every weight
 * written in a declaration counts, `var()` fallbacks included: a fallback
 * renders as soon as its property is unset anywhere. Definitions reached
 * through variables count only where they can render. Variables and
 * the callables their named arguments go to are followed by name (`-` and `_`
 * alike), through `@forward … as prefix-*` and its `show`/`hide` lists too.
 * A parameter default counts where a call leaves it out, or when no call is
 * in sight; against the JetBrains Mono cap, only a call that meets that
 * family passes a weight (one in a mixin another module includes always
 * may). A weight set from code is read per value it can take, so a
 * condition's numbers are not weights, a template literal as each text its
 * literal `${…}` parts produce (`` `65${0}` `` is 650; a weight it builds
 * around another value is computed), and CSS text that a string leaves to
 * code (`'font-weight:' + w`) is read from the operand after the `+`. A
 * partial's `!default` gives way where every load of it configures the
 * name. A file is read as the browser reads it: CSS escapes in names
 * decoded as Sass decodes them (`font-w\65 ight` is `font-weight`),
 * markup's character references too (`&#54;50` is 650), and a family's
 * static interpolation as Sass writes it out (`#{'Jet' + 'Brains'}` is
 * `JetBrains`). Not traced:
 * JavaScript escapes in TypeScript (`fontW\u0065ight`), positional mixin
 * or function arguments, calls through `meta.apply`, `meta.load-css` and
 * `@function` return values, so pass weights as named `$…weight` arguments;
 * nor values TypeScript stores and binds later (a component field, signal or
 * input read by `[style.fontWeight]="weight"`), so bind a literal or keep
 * the field's literal on the scale.
 *
 * A stylesheet rule set in JetBrains Mono (its own `font-family` or `font`,
 * written out or through variables, or one a nested rule inherits; see
 * `familiesOf`) is capped at `MONO_WEIGHT_CAP`. A mixin's top-level
 * declarations land where it is included, in the order Sass writes them
 * out: in its own file, as the definition in scope when the include runs
 * (a rule's declared before it, a mixin body's where that mixin is
 * included), or in another module that includes its last definition by a
 * name Sass resolves to it (`ns.m`,
 * through `@forward` prefixes and `show`/`hide`, or a bare `m` that
 * `@use … as *` or `@import` brings in; see `scanWorkspace`). There its weights meet the including rule's family,
 * reported once at the mixin's own line, and its family becomes that
 * rule's. A content block lands too where a mixin of the same file places
 * `@content` at its top level, a rule this file `@extend`s whole applies to
 * its extenders, and a keyframe's declarations (of its last definition)
 * apply where a rule's last `animation` runs it, over the rule's own and
 * under `!important` ones, while it runs and, unless it holds a frame
 * (`forwards`, `both`, `infinite`), the rule's own after. An `:is()` or
 * `:where()` reads as the selectors it holds (`:where(.p) .c` is `.p .c`).
 * A rule also sets the family of the narrower selectors it reaches (`.x`
 * for `.x:hover`, `.p .x` for `.w .p .x:hover`), compound by compound
 * across what its combinators allow; of those, the element's own rule and
 * `*`, the cascade winner counts (`!important`, layer, specificity, source
 * order; a `@layer` always applies, and `revert-layer` falls back past its
 * own). Without a family of its own, a rule takes one from an ancestor its
 * compiled selector names (an `@at-root` rule's as Sass writes it out),
 * else from the document root (`:host`, `body`, `html`, `:root`) in its
 * file; a family applies under conditions (`@media`, `@supports`, `@if`)
 * that the reader shares, or always. Sass conditions are not evaluated: each
 * `@if`/`@else` branch counts as one that may run, in a rule, a mixin or a
 * content block alike.
 *
 * Not traced: global styles in another file, a weight inherited from another
 * rule, a mixin's nested rules and at-rules (and a `@content` placed in one,
 * or in another module's mixin), a mixin name that two `@import`ed files
 * define (the later wins), a custom property a mixin's family reads
 * (resolved where the mixin is written, not on the rule that includes it),
 * a family set on an element from code, and one that reaches only some of a
 * rule's elements (a more specific `.x.active`, or `@extend .m` into
 * `.m.active`). Animations are read as a whole: a keyframe's steps cascade
 * as one rule rather than as states in turn, a rule's last `animation` runs
 * whatever an earlier `!important` one sets, one layer holding a frame
 * holds all of them, and a quoted name is read word by word.
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
const SOURCE = /\.(ts|html|svg)$/;

/**
 * Stylesheets feed weights through `font-weight`, custom properties, Sass
 * variables and Material token maps, so any name ending in `weight` counts.
 * In TypeScript, HTML and SVG only CSS text is in scope, never a variable that
 * happens to be called `…Weight`. CSS names, keywords and functions are
 * case-insensitive, so every pattern below that matches CSS text is too.
 */
const STYLESHEET_WEIGHT = /(?<![\w$-])((?:\$|--)?[\w-]*weight)\s*:/gi;
const SOURCE_WEIGHT =
    /(?<![\w$-])(font-weight|fontWeight|--[\w-]*weight)['"`]?\]?\s*:/gi;
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
    /(\[(?:style|attr)\.(font-weight|fontWeight|font|--[\w-]+)\])['"]?\s*[:=]\s*(['"])([\s\S]*?)\3/gi;
/**
 * Angular `@HostBinding('style.fontWeight')` (or `style.font-weight`,
 * `style.--x`, `attr.font-weight`) on a field (`= value`) or a getter
 * (`return value`).
 */
const HOST_BINDING =
    /@HostBinding\(\s*(['"`])(style|attr)\.(font-weight|fontWeight|font|--[\w-]+)\1\s*\)/g;
const HOST_GETTER =
    /^\s*(?:(?:public|private|protected|override|static)\s+)*get\s+[\w$]+\s*\(\s*\)\s*(?::[^{]+)?\{/;
const HOST_FIELD =
    /^\s*(?:(?:public|private|protected|readonly|override|static)\s+)*[\w$]+\s*[!?]?\s*(?::[^=;]+)?=(?!=)/;
/**
 * A Sass property name built by interpolation (`font-#{weight}`,
 * `#{'font-weight'}`, `#{$prop}`).
 */
const INTERPOLATED_NAME = /(?<![\w$#{-])((?:[\w-]*#\{[^{}]*\})+[\w-]*)\s*:/g;
/**
 * DOM writes of the weight or the `font` shorthand, dotted or indexed
 * (`style['font-weight']`). `===` compares, so only a lone `=` (or `+=` and
 * kin, or a logical `||=`) assigns.
 */
const CODE_ASSIGNMENT =
    /(\.style(?:\.(font(?:Weight)?)|\[\s*(['"`])(font(?:Weight|-weight)?)\3\s*\]))\s*(\*\*|[-+*/%]|\|\||&&|\?\?)?=(?!=)/g;
/** A logical assignment stores its right-hand side as it is. */
const LOGICAL_ASSIGNMENT = /^(?:\|\||&&|\?\?)$/;
/**
 * Runtime setters, by the arguments before the property name and the names
 * that set a weight or a custom property: `style.setProperty(name, value)`,
 * Angular's `Renderer2.setStyle(element, 'fontWeight', value, flags?)` and
 * SVG presentation attributes, `setAttribute(NS)`. Each argument is read as
 * a whole expression, so `setStyle(wrap(getEl()), …)` counts too.
 */
const CODE_SETTER =
    /\b(setProperty|setStyle|setAttribute|setAttributeNS)\s*\(/g;
const SETTERS = {
    setProperty: { skip: 0, property: /^(?:font-weight|font|--[\w-]+)$/i },
    setStyle: { skip: 1, property: /^(?:font-?weight|font|--[\w-]+)$/i },
    setAttribute: { skip: 0, property: /^font-weight$/i },
    setAttributeNS: { skip: 1, property: /^font-weight$/i },
};
const QUOTED_NAME = /^(\s*(['"`])([^'"`]*)\2)\s*,/;
/**
 * CSS-wide keywords on a custom property: `initial` leaves it unset;
 * `inherit` and `unset` take the parent's value, whatever another rule
 * sets, and so do `revert` and `revert-layer` (the browser has no value of
 * its own for it, and a lower layer's is another rule).
 */
const RESETTING = /^initial\b/i;
/** At-rules whose body applies only under a condition. */
const CONDITIONAL_RULE = /^@(?:media|supports|container|document)\b/i;
const INHERITING = /^(?:inherit|unset|revert|revert-layer)\b/i;
const WEIGHT_SETTER = /(?<![\w$-])(font-weight|font|weight)\s*:/gi;
/** A property name that sets or holds a weight. */
const WEIGHT_NAME = /^(?:font|font-weight|(?:\$|--)?[\w-]*weight)$/i;
/** A family declaration in CSS text: `font-family`, or the `font` shorthand. */
const FAMILY_DECLARATION = /(?<![\w-])(font-family|font)\s*:\s*([^;]*)/gi;
/** A CSS number token, whole: `650`, `.65e3`, `6.5E2` (not `650.`). */
const NUMBER_TOKEN = /^[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?$/i;
/** An integer token: no fraction and no exponent (`6e2` is a number). */
const INTEGER_TOKEN = /^[+-]?\d+$/;

/** The math functions of plain numbers, with how many arguments each takes. */
const MATH_ARITY = Object.freeze({
    ...{ calc: [1, 1], min: [1, Infinity], max: [1, Infinity], clamp: [3, 3] },
    ...{ round: [1, 2], mod: [2, 2], rem: [2, 2], abs: [1, 1], sign: [1, 1] },
    ...{ pow: [2, 2], sqrt: [1, 1], hypot: [1, Infinity], log: [1, 2] },
    exp: [1, 1],
});
const MATH_CONSTANT = /^(?:e|pi|-?infinity|nan)$/i;
const ROUNDING = /^(?:nearest|up|down|to-zero)$/i;
/** One token of a math value: whitespace, a number, a name or function, a sign. */
const MATH_TOKEN =
    /\s+|[+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?(?![\w%.])|-?[a-z][\w-]*\(?|[()+\-*/,]/iy;

/** A math value's tokens, each with whether whitespace precedes it. */
function mathTokens(value) {
    const tokens = [];
    let space = false;
    MATH_TOKEN.lastIndex = 0;
    while (MATH_TOKEN.lastIndex < value.length) {
        const token = MATH_TOKEN.exec(value)?.[0];
        if (token === undefined) return null;
        if (/^\s/.test(token)) space = true;
        else tokens.push({ text: token, space });
        if (!/^\s/.test(token)) space = false;
    }
    return tokens;
}

/**
 * Whether `value` is a math function of plain numbers (`calc(600 + 50)`,
 * `max(600, 650)`): computationally independent, so a valid `<number>` or
 * `<integer>` initial value. It parses as CSS does: each function takes its
 * number of arguments, `+` and `-` need whitespace on both sides, and a unit,
 * `%` or `var()` makes it invalid there.
 */
function numericMath(value) {
    const tokens = mathTokens(value.trim());
    if (!tokens || !/\($/.test(tokens[0]?.text ?? '')) return false;
    let i = 0;
    const next = () => tokens[i]?.text;
    const sum = () => {
        if (!product()) return false;
        while (next() === '+' || next() === '-') {
            if (!tokens[i].space || !tokens[i + 1]?.space) return false;
            i += 1;
            if (!product()) return false;
        }
        return true;
    };
    const product = () => {
        if (!operand()) return false;
        while (next() === '*' || next() === '/') {
            i += 1;
            if (!operand()) return false;
        }
        return true;
    };
    const operand = () => {
        const token = next() ?? '';
        i += 1;
        if (/^[+-]?[\d.]/.test(token) || MATH_CONSTANT.test(token)) return true;
        if (token === '(') return sum() && tokens[i++]?.text === ')';
        const name = /^([a-z][\w-]*)\($/i.exec(token)?.[1].toLowerCase();
        if (!name || !Object.hasOwn(MATH_ARITY, name)) return false;
        if (name === 'round' && ROUNDING.test(next() ?? '')) {
            if (tokens[i + 1]?.text !== ',') return false;
            i += 2;
        }
        let count = 0;
        do {
            if (!sum()) return false;
            count += 1;
        } while (next() === ',' && ++i);
        const [fewest, most] = MATH_ARITY[name];
        return tokens[i++]?.text === ')' && count >= fewest && count <= most;
    };
    return operand() && i === tokens.length;
}

/**
 * Whether a `@property` body is a valid registration of `value`: it has a
 * `syntax` and `inherits`, and the syntax accepts the value (`*` anything,
 * `<number>` a number, `<integer>` an integer, either a math function of
 * numbers, `<custom-ident>`/`<string>` a name).
 */
function registrationAccepts(body, value) {
    const syntax = /(?<![\w-])syntax\s*:\s*(['"])(.*?)\1/i.exec(body)?.[2];
    const inherits = /(?<![\w-])inherits\s*:\s*(?:true|false)\b/i.test(body);
    if (syntax === undefined || !inherits) return false;
    if (syntax.trim() === '*') return true;
    if (numericMath(value)) return /<(?:number|integer)>/i.test(syntax);
    if (!NUMBER_TOKEN.test(value)) {
        return /<(?:custom-ident|string)>/i.test(syntax);
    }
    return (
        /<number>/i.test(syntax) ||
        (INTEGER_TOKEN.test(value) && /<integer>/i.test(syntax))
    );
}

/** A run of whitespace, or a quoted string (its spaces are its own). */
const SPACING = /(['"])(?:\\[\s\S]|(?!\1)[^\\])*\1|\s+/g;

/**
 * Whether rules with the selector chains `a` style every element that ones
 * with `b` do (see `selectorsOf` in `scanWeights`).
 */
function covers(a, b) {
    return Boolean(a && b?.length) && b.every((chain) => a.includes(chain));
}

/** A registered custom property: `@property --x { … }`. */
const PROPERTY_RULE = /@property\s+(--[\w-]+)\s*\{/gi;
/** Sass loops that bind variables: `@each $a, $b in …`, `@for $i from …`. */
const EACH_LOOP = /@each\s+((?:\$[\w-]+\s*,\s*)*\$[\w-]+)\s+in\s+([^{]+)\{/gi;
const FOR_LOOP =
    /@for\s+(\$[\w-]+)\s+from\s+([\s\S]+?)\s+(through|to)\s+([\s\S]+?)\s*\{/gi;
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

/** A Sass variable in a family, interpolated (`#{$x}`) or not (`ns.$x`). */
const SASS_VALUE =
    /#\{\s*((?:[\w-]+\.)?\$[\w-]+)\s*\}|((?:[\w-]+\.)?\$[\w-]+)/g;

/** A Sass variable's value as it is substituted: no flags, no outer quotes. */
function sassValue(value) {
    return value
        .replace(/!(?:default|global)\b/gi, '')
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
}

/**
 * The variables a family reads (see `familyParts`), as references resolved
 * from `at` (a file, position and scope): each custom property with its
 * `var()` fallback, then any Sass variable named outright.
 */
function familyRefs({ outside, vars }, at) {
    const place = {
        ...{ file: at.file, index: at.index, scopes: at.scopes },
        ...{ inCallable: at.inCallable, callable: at.callable },
        ...{ guards: at.guards ?? [], rule: at.rule ?? null },
        selectors: at.selectors ?? null,
        // Read inside a `font` shorthand: values are shorthands too.
        shorthand: at.shorthand ?? false,
    };
    return [
        ...vars.map(({ name, fallback }) => ({
            ...{ name, namespace: null, mode: 'family', fallback },
            ...place,
        })),
        // A string is a name, unless Sass interpolates in it (`"#{$x}"`).
        ...[
            ...outside
                .replace(/(['"])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, (m) =>
                    m.includes('#{') ? m : ' '.repeat(m.length)
                )
                .matchAll(REFERENCE),
        ].map((match) => ({
            name: identity(match[1] ?? match[3]),
            namespace: match[2] ?? null,
            ...{ mode: 'family', fallback: null },
            ...place,
        })),
    ];
}

/**
 * The names a Sass property name can compose to: a quoted or bare literal
 * interpolation stands for itself and a variable for each value
 * `valuesOf` gives it (none when it cannot be resolved), up to 16.
 */
function composedNames(name, valuesOf) {
    let names = [''];
    let last = 0;
    for (const match of name.matchAll(/#\{\s*([^{}]*?)\s*\}/g)) {
        const inner = match[1];
        const literal = /^(['"])(.*)\1$/.exec(inner);
        let values = [];
        if (literal) values = [literal[2]];
        else if (/^[\w-]+$/.test(inner)) values = [inner];
        else if (/^\$[\w-]+$/.test(inner)) values = valuesOf(inner);
        const between = name.slice(last, match.index);
        names = names
            .flatMap((prefix) => values.map((v) => prefix + between + v))
            .slice(0, 16);
        last = match.index + match[0].length;
    }
    return names.map((prefix) => prefix + name.slice(last));
}

/**
 * Where the parameters end before a TypeScript return type that `before`
 * ends with (`): { weight: number }`, `): Promise<{ a: 1 }>`), or -1: the
 * return type is read back as one balanced expression to its `:`.
 */
function returnTypeStart(before) {
    let depth = 0;
    for (let k = before.length - 1; k >= 0; k -= 1) {
        const char = before[k];
        if (char === '>' && before[k - 1] === '=') {
            k -= 1;
        } else if ('})]>'.includes(char)) {
            depth += 1;
        } else if ('{([<'.includes(char)) {
            if (depth === 0) return -1;
            depth -= 1;
        } else if (depth === 0 && char === ':') {
            return before.slice(0, k).trimEnd().length;
        } else if (depth === 0 && /[;=]/.test(char)) {
            return -1;
        }
    }
    return -1;
}

/**
 * Whether the `{` at `brace` opens a function body: after `=>`, or after a
 * parameter list that no `if`/`for`/`while`/`switch`/`catch` owns.
 */
function opensFunction(text, brace) {
    let before = text.slice(0, brace).trimEnd();
    if (before.endsWith('=>')) return true;
    // A TypeScript return type sits between the parameters and the body.
    const typed = returnTypeStart(before);
    if (typed !== -1) before = before.slice(0, typed);
    if (!before.endsWith(')')) return false;
    let depth = 0;
    let k = before.length - 1;
    for (; k >= 0; k -= 1) {
        if (before[k] === ')') depth += 1;
        else if (before[k] === '(' && (depth -= 1) === 0) break;
    }
    const word = /([\w$]+)\s*$/.exec(before.slice(0, k))?.[1] ?? '';
    return !/^(?:if|for|while|switch|catch|with)$/.test(word);
}

/** Whether `index` sits where a definition exists: a loop variable's body. */
function inLoopOf(definition, index) {
    const { loop } = definition;
    return !loop || (loop.start < index && index < loop.end);
}

/**
 * Whether the family in effect in a block of CSS text is JetBrains Mono: the
 * last `font-family` or parsing `font` declaration, unless an earlier one is
 * `!important`.
 */
function familyInCss(css) {
    let effective = null;
    for (const [, property, value] of css.matchAll(FAMILY_DECLARATION)) {
        if (property.toLowerCase() === 'font' && !parsesAsFont(value)) continue;
        const important = IMPORTANT.test(value);
        if (effective?.important && !important) continue;
        const shorthand = property.toLowerCase() === 'font';
        effective = { important, mono: rendersMono(value, { shorthand }) };
    }
    return effective?.mono ?? false;
}

/**
 * A `@for` variable read as a weight: a range of literal bounds is one
 * weight only when both are the same scale weight; any other range (or a
 * bound Sass computes) yields values the source does not show.
 */
function rangeAnalysis({ range, value }) {
    const [from, to] = [Number(range.from), Number(range.to)];
    const literal = Number.isFinite(from) && Number.isFinite(to);
    // `through` includes the end, `to` stops before it (`from 6 to 6` runs
    // no times).
    const count = Math.abs(to - from) + (range.through ? 1 : 0);
    const silent =
        literal &&
        (count === 0 || (count === 1 && WEIGHT_SCALE.includes(from)));
    return {
        terms: silent ? [] : [{ value, computed: true }],
        references: [],
    };
}

/**
 * The positions in a Sass list where `char` sits outside parentheses and
 * strings (`("a, b" 650, c)` has one top-level comma).
 */
function topLevel(text, char) {
    const at = [];
    let depth = 0;
    let quote = '';
    for (let i = 0; i < text.length; i += 1) {
        if (quote) {
            if (text[i] === '\\') i += 1;
            else if (text[i] === quote) quote = '';
        } else if (text[i] === '"' || text[i] === "'") quote = text[i];
        else if (text[i] === '(') depth += 1;
        else if (text[i] === ')') depth -= 1;
        else if (text[i] === char && depth === 0) at.push(i);
    }
    return at;
}

/** Where a list item's `:` sits outside parentheses and strings, or -1. */
function topLevelColon(item) {
    return topLevel(item, ':')[0] ?? -1;
}

/** A Sass list split at its top-level commas, outer parentheses dropped. */
function listItems(list) {
    const inner = /^\((.*)\)$/s.exec(list.trim())?.[1] ?? list;
    const items = [];
    let from = 0;
    for (const comma of topLevel(inner, ',')) {
        items.push(inner.slice(from, comma).trim());
        from = comma + 1;
    }
    return [...items, inner.slice(from).trim()].filter(Boolean);
}

/**
 * What each variable of `@each $a, $b in …` takes, as a list: for a map,
 * the first the keys and the second the values; for a list of lists, each
 * its position in every item (a quoted `"wide label"` is one element). One
 * variable takes the whole list.
 */
function loopColumns(list, count) {
    if (count === 1) return [list];
    const items = listItems(list);
    // A map entry has its `:` outside parentheses (`(a b): 650` too).
    const colons = items.map(topLevelColon);
    const map = colons.every((colon) => colon !== -1);
    const rows = items.map((item, i) =>
        map
            ? [item.slice(0, colons[i]), item.slice(colons[i] + 1)]
            : tokensOf(item.replace(/^\((.*)\)$/s, '$1'))
    );
    return Array.from({ length: count }, (_, i) =>
        rows
            .map((row) => (row[i] ?? '').trim())
            .filter(Boolean)
            .join(', ')
    );
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

/** A string literal in code, whole: its quote and its text. */
const STRING_LITERAL = /^\s*(['"`])([\s\S]*)\1\s*$/;

/**
 * The CSS text a value set from code can hold: the text of each string
 * literal it can give (see `resultsOf`); any other result as written.
 */
function cssOfCode(expression) {
    return resultsOf(expression).map(
        (result) => STRING_LITERAL.exec(result)?.[2] ?? result
    );
}

/** A JavaScript number literal (`0x28a`, `0o1212`, `6_50`, `650n`). */
const JS_NUMBER =
    /(?<![\w$.])(?:0[xob][\da-f_]+|\d[\d_]*(?:\.[\d_]*)?(?:e[+-]?\d[\d_]*)?)n?(?![\w$.])/gi;

/**
 * Code with each number literal spelled other than in decimal written as
 * the number JavaScript makes of it (`0x28a` is `650`, also in a branch or
 * an operand), so it reads as the weight a setter receives.
 */
function numberText(code) {
    return code.replace(JS_NUMBER, (literal) => {
        if (!/^0[xob]|_|n$/i.test(literal)) return literal;
        const value = Number(literal.replace(/_|n$/gi, ''));
        return Number.isFinite(value) ? String(value) : literal;
    });
}

/** A literal's text as JavaScript puts it in a string, or `null`. */
function literalText(result) {
    const string = STRING_LITERAL.exec(result);
    if (string) return string[2].includes('${') ? null : string[2];
    const number = Number(result.trim());
    return Number.isFinite(number) ? String(number) : null;
}

/**
 * The texts a template literal's body can produce when every `${…}` in it
 * gives literals (`65${0}` is `650`, `${wide ? 650 : 600}` is `650` or
 * `600`), up to 16 of them; `null` when one gives anything else.
 */
export function templateTexts(body) {
    let texts = [''];
    for (const part of templateParts(body)) {
        const values =
            part.code === undefined
                ? [part.text]
                : resultsOf(part.code).map(literalText);
        if (values.includes(null)) return null;
        texts = texts.flatMap((text) => values.map((value) => text + value));
        if (texts.length > 16) return null;
    }
    return texts;
}

/** Analyses merged into one. */
function merged(analyses) {
    return {
        terms: analyses.flatMap((analysis) => analysis.terms),
        references: analyses.flatMap((analysis) => analysis.references),
    };
}

/**
 * A value set from code, read per result it can take (see `resultsOf`), so
 * a condition's numbers are not weights. A string literal is CSS text and is
 * read as such, a template as each text it can produce; anything else is an
 * expression, where other numbers appear too (a weight is 100 or more) and
 * arithmetic computes the value.
 */
function analyseCode(expression, mode = 'weight', after = 0, cap = null) {
    // A shorthand that names JetBrains Mono meets its cap.
    const css = (text) => {
        const mono = mode === 'font' && rendersMono(text, { shorthand: true });
        return analyse(mode, text, {
            after,
            cap: mono ? MONO_WEIGHT_CAP : cap,
        });
    };
    return merged(
        resultsOf(expression).map((result) => {
            const literal = STRING_LITERAL.exec(result);
            if (!literal) {
                return analyse('weight', numberText(result), {
                    minimum: 100,
                    code: true,
                    cap,
                });
            }
            const texts = literal[2].includes('${')
                ? templateTexts(literal[2])
                : [literal[2]];
            if (texts) return merged(texts.map(css));
            // `${w}` alone is `w`. Around a value the scan cannot know, a
            // shorthand's other tokens still read as CSS, while a weight is
            // computed from it (`6${w}`).
            const parts = templateParts(literal[2]);
            if (parts.length === 1 && parts[0].code !== undefined) {
                return analyseCode(parts[0].code, mode, after, cap);
            }
            if (mode === 'font') return css(literal[2]);
            return {
                terms: [{ value: result.trim(), computed: true }],
                references: [],
            };
        })
    );
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
 * An `@include` of a mixin: `ns.name` names another module's, as does a
 * bare name that no mixin of the including file has.
 */
const INCLUDE = /@include\s+(?:([\w-]+)\.)?([\w-]+)(?![\w.-])/g;

/**
 * One file's weight declarations: off-scale findings, the custom properties
 * and Sass variables its weights refer to, and every such variable it defines
 * (checked later, once the whole workspace has named what it refers to).
 * A keyframe that sets a font only while it runs is read both ways: its
 * frames over the rule that runs it, and that rule after it.
 * Its module mixins' top-level families and weights (`mixins`) land where
 * other modules include them, and theirs here: `included` gives, by the
 * position of each such `@include` (`includes`), the mixins it reaches, and
 * `elsewhere` names this file's mixins that other modules include (see
 * `scanWorkspace`). A mixin read both ways carries the second (`after`), so
 * a module that includes it reads it both ways too.
 */
export function scanWeights(file, written, modules = {}) {
    const { included = new Map() } = modules;
    const running = scanPass(file, written, true, modules);
    const mixins = [...included.values()].flat();
    if (!running.transient && !mixins.some((mixin) => mixin.after)) {
        return running;
    }
    const after = scanPass(file, written, false, {
        ...modules,
        included: new Map(
            [...included].map(([site, reached]) => [
                site,
                reached.map((mixin) => mixin.after ?? mixin),
            ])
        ),
    });
    const keyOf = (item) => JSON.stringify(item);
    const union = (a, b) => [
        ...new Map([...a, ...b].map((item) => [keyOf(item), item])).values(),
    ];
    return {
        ...running,
        findings: union(running.findings, after.findings),
        deferred: union(running.deferred, after.deferred),
        // A call meets the families of either reading.
        includeCalls: new Map(
            [...running.includeCalls].map(([index, call]) => {
                const other = after.includeCalls.get(index);
                return [
                    index,
                    {
                        ...call,
                        mono: call.mono || Boolean(other?.mono),
                        families: union(call.families, other?.families ?? []),
                    },
                ];
            })
        ),
        mixins: new Map(
            [...running.mixins].map(([name, mixin]) => [
                name,
                { ...mixin, after: after.mixins.get(name) },
            ])
        ),
    };
}

function scanPass(
    file,
    written,
    transient,
    { included = new Map(), elsewhere = new Set() }
) {
    // Read as the browser reads it (markup references and CSS escapes
    // decoded); lines are the file's own.
    const { text: source, origin } = decodeSource(file, written);
    const lexed = lex(file, source);
    const { text, quoteAt } = lexed;
    const writtenLine = lineIndex(written);
    const lineOf = origin ? (index) => writtenLine(origin[index]) : writtenLine;
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
    const blockAt = new Map(blocks.map((block) => [block.start, block]));
    // The flow-control and conditional at-rule blocks around a position.
    const guardsAt = (index) =>
        blocks
            .filter((block) => block.start < index && index < block.end)
            .filter(
                (block) =>
                    block.kind === 'flow' ||
                    CONDITIONAL_RULE.test(block.prelude)
            )
            .map((block) => block.start);
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

    // The character before `index`, whitespace skipped.
    const charBefore = (index) => {
        let before = index - 1;
        while (before >= 0 && /\s/.test(text[before])) before -= 1;
        return text[before] ?? '';
    };
    // This file's Sass variable declarations, read for interpolated
    // selectors (see `selectorOf`), in source order.
    let assignments = null;
    const assignmentsOf = () =>
        (assignments ??= [...text.matchAll(DEFINITION)]
            .filter(
                ({ 1: name, index }) => name.startsWith('$') && !inString(index)
            )
            // A `$x: 1` right after `(` or `,` is an argument.
            .filter(({ index }) => !['(', ','].includes(charBefore(index)))
            .map((match) => ({
                key: identity(match[1]),
                index: match.index,
                value: valueAfter(lexed, match.index + match[0].length).value,
                place: placeOf(blocks, match.index),
            })));
    // The literal a Sass variable holds at `at`: its last declaration there,
    // when that is a plain name or string set unconditionally in a scope
    // around `at`; `null` when the scan cannot know (a module member, an
    // `@if`, a `!default` / `!global` assignment, or one outside the mixin
    // that `at` is in).
    const literalAt = (name, at) => {
        const key = identity(name);
        const scopes = placeOf(blocks, at).scopes;
        const before = assignmentsOf().filter(
            (a) => a.key === key && a.index < at
        );
        if (before.some((a) => /!\s*(?:default|global)\b/i.test(a.value))) {
            return null;
        }
        const last = before
            .filter((a) => scopes.includes(a.place.scope))
            .at(-1);
        if (!last || last.place.flow) return null;
        // In a mixin, only its own assignments are known where it is
        // included; one outside may change before the `@include`.
        const inside = placeOf(blocks, at);
        if (inside.inCallable && last.place.callable !== inside.callable) {
            return null;
        }
        const value = /^\s*(?:([\w-]+)|(['"])([^'"]*)\2)\s*$/.exec(last.value);
        return value ? (value[1] ?? value[3]) : null;
    };
    // The selector chains of the blocks around a place, innermost first:
    // one per selector of each list (`.a, .b { .x {} }` is `.x < .a` and
    // `.x < .b`), and two rules with a chain in common style its elements.
    // Spacing outside strings is the same selector; inside one
    // (`[title="a  b"]`) it is not. A Sass interpolation reads the literal
    // its variable holds there (`$n: a; .#{$n}` is `.a`); one the scan cannot
    // know, or more than 16 chains, makes the block's chain its own.
    const selectorsOf = (scopes) => {
        let chains = [''];
        // Past an `@at-root`, the blocks it leaves out (see
        // `atRootExcludes`) are not written out around it.
        let excluded = () => false;
        for (const scope of scopes) {
            if (scope === null) continue;
            const written = blockAt
                .get(scope)
                .prelude.replace(SPACING, (m) => (/^\s/.test(m) ? ' ' : m))
                .replace(
                    /#\{\s*(\$[\w-]+)\s*\}/g,
                    (m, name) => literalAt(name, scope) ?? m
                );
            const excludes = atRootExcludes(written);
            const prelude = excludes
                ? written.replace(/^@at-root\b\s*/i, '')
                : written;
            if (excludes) {
                const outer = excluded;
                excluded = (kind) => outer(kind) || excludes(kind);
                if (!prelude || prelude.startsWith('(')) continue;
            } else if (excluded(blockKind(prelude))) continue;
            // Each unnamed `@layer { … }` is a layer of its own.
            const parts = /^@layer\s*$/i.test(prelude)
                ? [`@layer @${scope}`]
                : /^@|#\{/.test(prelude)
                  ? [prelude]
                  : selectorList(prelude).map(canonicalSelector);
            chains = chains.flatMap((chain) =>
                parts.map((part) => (chain ? `${chain} < ${part}` : part))
            );
        }
        const known = chains.length <= 16 && !chains.join().includes('#{');
        return known ? chains : [`${chains.join(', ')} @ ${scopes.join(' ')}`];
    };
    // Blocks with a selector chain in common (and the same `@if` or `@each`
    // around them) are one rule to the cascade for it: its declarations
    // apply in source order, whichever block holds them. A block is in one
    // rule per chain.
    const rulesOf = (start) => {
        if (start === null || start === undefined) return [];
        const flow = blocks
            .filter(
                (b) => b.kind === 'flow' && b.start < start && start < b.end
            )
            .map((b) => b.start);
        const chains = selectorsOf(placeOf(blocks, start + 1).scopes);
        return chains.map((chain) => `${chain} | ${flow.join(' ')}`);
    };
    // The family each rule renders in (see `familiesOf`); one named through
    // variables is resolved once the whole workspace is scanned.
    const refsIn = (parts, index, place) =>
        familyRefs(parts, {
            ...{ file, index, ...place, guards: guardsAt(index) },
            rule: blockAt.get(place.scope)?.prelude ?? null,
            selectors: selectorsOf(place.scopes),
        });
    const monoAt = stylesheet
        ? familiesOf(
              lexed,
              blocks,
              { inString, placeOf, refsIn, rulesOf, transient },
              {
                  included: new Map(
                      [...included].map(([site, mixins]) => [
                          site,
                          mixins.flatMap((mixin) => mixin.families),
                      ])
                  ),
                  elsewhere,
              }
          )
        : Object.assign(() => ({ mono: false, refs: [] }), {
              ...{ landings: () => [], landingsAt: () => [] },
              ...{ memberOf: () => null, exported: new Map() },
              ...{ definitionsAt: () => ({ defs: [], open: true }) },
              callAt: () => null,
          });
    // Where a family declaration sits, for its variables to resolve later
    // there; one from another module's mixin carries its own.
    const siteOf = (entry) =>
        entry.at.file
            ? entry.at
            : {
                  ...{ ...entry.at, file },
                  guards: guardsAt(entry.at.index),
                  rule: blockAt.get(entry.at.scope)?.prelude ?? null,
                  selectors: selectorsOf(entry.at.scopes ?? []),
              };
    // A weight's terms and variables as a JetBrains Mono rule caps them,
    // with where to report them.
    const capped = (name, index, mode, value) => {
        const analysis = analyse(mode, value, { cap: MONO_WEIGHT_CAP });
        const place = placeOf(blocks, index);
        return {
            ...{ file, line: lineOf(index), name },
            terms: analysis.terms.filter(capOnly),
            references: analysis.references.map((reference) => ({
                ...{ ...reference, file, index },
                ...{ scopes: place.scopes, callable: place.callable },
                inCallable: place.inCallable,
            })),
        };
    };
    // Weights in rules whose family is named through variables: capped once
    // that family resolves to JetBrains Mono.
    const deferred = [];
    // Each rule's weight declarations (`font-weight` and the `font`
    // shorthand): a later one, unless only the earlier is `!important`,
    // replaces it, so only the one in effect meets the cap.
    const setters = new Map();
    // The weight declarations landing in this file's module mixins (one of
    // another module's too), for the modules that include them, and how
    // this file's own read where a JetBrains Mono rule caps them.
    const setInMixins = [];
    const weightAt = new Map();
    // A weight declaration registers in each rule it lands in (a mixin's
    // where it is included), at the place it lands; `id` is its position,
    // or for another module's, its file and position there. A keyframe's
    // weight, where a rule runs it, outranks the rule's own (`animated`, on
    // the way to a mixin another module includes, or here).
    const setAt = (id, important, landings, weight = null, ran = false) => {
        for (const landing of landings) {
            const { rules, key, scope, animated: here } = landing;
            const animated = ran || Boolean(here);
            for (const rule of rules) {
                if (!setters.has(rule)) setters.set(rule, []);
                const level = levelOf({ important, animated });
                setters.get(rule).push({ key, index: id, level });
            }
            const mixin = monoAt.memberOf(scope);
            if (mixin !== null && landing.external !== false) {
                setInMixins.push({
                    ...{ mixin, key, id },
                    ...{ important, animated, weight },
                });
            }
        }
    };
    for (const match of stylesheet ? text.matchAll(WEIGHT_SETTER) : []) {
        if (inString(match.index) || inConditionPrelude(lexed, match.index)) {
            continue;
        }
        if (!startsDeclaration(text, match.index)) continue;
        const start = match.index + match[0].length;
        const { value, selector } = declarationText(lexed, start);
        if (selector) continue;
        if (match[1].toLowerCase() === 'font' && !parsesAsFont(value)) continue;
        // A nested `font: { weight: … }` sets its rule's weight.
        const namespace = fontNamespaceRule(
            blocks,
            placeOf(blocks, match.index)
        );
        if (match[1].toLowerCase() === 'weight' && namespace === undefined) {
            continue;
        }
        setAt(match.index, IMPORTANT.test(value), monoAt.landings(match.index));
    }
    // An `all` reset replaces an earlier weight too.
    for (const match of stylesheet ? text.matchAll(ALL_RESET) : []) {
        if (inString(match.index) || inConditionPrelude(lexed, match.index)) {
            continue;
        }
        if (startsDeclaration(text, match.index)) {
            const landings = monoAt.landings(match.index);
            setAt(match.index, Boolean(match[2]), landings);
        }
    }
    // Another module's mixin sets its weights where this file includes it.
    const landed = [...included].flatMap(([site, mixins]) =>
        mixins.flatMap((mixin) =>
            mixin.setters.map((setter) => ({
                ...{ site, setter },
                landings: monoAt.landingsAt(site, setter.key),
            }))
        )
    );
    for (const { setter, landings } of landed) {
        const { id, important, weight, animated } = setter;
        setAt(id, important, landings, weight, animated);
    }

    // A shorthand that fails to parse is dropped, so it sets nothing.
    // In a selector list, it is in effect while it is for any selector.
    // A weight is in effect where, in a rule it lands in, nothing later
    // replaces it and nothing earlier outranks it (`!important`): the
    // scopes of those landings, the only ones whose family it meets.
    const after = (a, b) => keyOrder(a.key, b.key) > 0;
    const effectiveIn = (index, landings = monoAt.landings(index)) => {
        const kept = landings.filter(({ rules, key }) =>
            rules.some((id) => {
                const rule = setters.get(id) ?? [];
                const own = rule.find(
                    (setter) =>
                        setter.index === index &&
                        keyOrder(setter.key, key) === 0
                );
                return (
                    Boolean(own) &&
                    !rule.some(
                        (other) =>
                            other !== own &&
                            (other.level > own.level ||
                                (other.level === own.level &&
                                    after(other, own)))
                    )
                );
            })
        );
        return new Set(kept.map(({ scope }) => scope));
    };

    // CSS text in a string (an inline `style="…"`, a component style) meets
    // the Mono cap when the declarations around it set JetBrains Mono.
    const monoInString = (index) => {
        const quote = quoteAt[index];
        if (!quote) return false;
        let start = index;
        let end = index;
        while (start > 0 && quoteAt[start - 1] === quote) start -= 1;
        while (end < text.length && quoteAt[end] === quote) end += 1;
        // The closing quote is not CSS.
        if (text[end - 1] === quote) end -= 1;
        const before = text.slice(start, index);
        const after = text.slice(index, end);
        const rule =
            before.slice(
                Math.max(before.lastIndexOf('{'), before.lastIndexOf('}')) + 1
            ) + after.slice(0, after.search(/[{}]|$/));
        return familyInCss(rule);
    };
    // Whether a `return` at `at` belongs to a function nested in the body
    // opened at `open` (an arrow, `function` or method), not to the body.
    const inNestedFunction = (open, at) => {
        const braces = [];
        for (let i = open + 1; i < at; i += 1) {
            if (quoteAt[i]) continue;
            if (text[i] === '{') braces.push(i);
            else if (text[i] === '}') braces.pop();
        }
        return braces.some((brace) => opensFunction(text, brace));
    };
    // A feature query's test is a condition, not a declaration.
    const inPrelude = (index) => stylesheet && inConditionPrelude(lexed, index);
    // In markup only CSS contexts style anything (see `inMarkupCss`).
    const markup = /\.(?:html|svg)$/.test(file);
    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            if (inString(match.index) || inPrelude(match.index)) continue;
            if (markup && !inMarkupCss(lexed, match.index)) continue;
            const name = match[1];
            const end = match.index + match[0].length;
            const read = valueAfter(lexed, end);
            const { selector } = read;
            // An unquoted attribute value ends at a space or `>`.
            const unquoted =
                markup &&
                !quoteAt[match.index] &&
                inUnquotedStyle(lexed, match.index);
            const value = unquoted ? read.value.split(/[\s>]/)[0] : read.value;
            if (selector) continue;
            const mode = name.toLowerCase() === 'font' ? 'font' : 'weight';
            // A TypeScript object value (`{ fontWeight: wide ? 700 : 600 }`),
            // or one in an Angular binding (`[ngStyle]="{…}"`), is code, read
            // per value it can take; a string is CSS text.
            const code =
                (file.endsWith('.ts') && !quoteAt[end]) || inBinding(text, end);
            if (!stylesheet && code) {
                const expression = codeExpression(text, end, {
                    argument: true,
                });
                record(name, match.index, analyseCode(expression, mode));
                continue;
            }
            const nested =
                /^weight$/i.test(name) &&
                fontNamespaceRule(blocks, placeOf(blocks, match.index)) !==
                    undefined;
            const weightName = /^font(?:-weight)?$/i.test(name) || nested;
            const effective = weightName ? effectiveIn(match.index) : new Set();
            const family =
                effective.size > 0
                    ? monoAt(match.index, (scope) => effective.has(scope))
                    : { mono: false, refs: [] };
            const inline =
                !stylesheet && weightName && monoInString(match.index);
            const cap = family.mono || inline ? MONO_WEIGHT_CAP : null;
            // CSS text in a string of code ends with that string; a value
            // left to code (`'font-weight:' + 650`) is the operand after `+`.
            const literal = stylesheet ? null : codeStringAt(lexed, file, end);
            const css = literal ? value.slice(0, literal.close - end) : value;
            const operand =
                literal && /^\s*$/.test(css)
                    ? concatenatedAfter(text, literal)
                    : null;
            if (operand !== null) {
                record(
                    name,
                    match.index,
                    analyseCode(operand, 'weight', 0, cap)
                );
                continue;
            }
            // A template's CSS reads as each text it can produce.
            const template = !stylesheet && css.includes('${');
            const texts = template ? templateTexts(css) : null;
            const cssOf = (text) => analyse(mode, text, { cap });
            record(name, match.index, merged((texts ?? [css]).map(cssOf)));
            if (!family.mono && family.refs.length > 0) {
                deferred.push({
                    ...capped(name, match.index, mode, value),
                    family: family.text,
                    shorthand: family.shorthand,
                    at: siteOf(family),
                });
            }
            if (stylesheet && weightName) {
                weightAt.set(match.index, () =>
                    capped(name, match.index, mode, value)
                );
            }
        }
    }
    // Another module's weight landing here meets the family of the rule
    // that includes it, and is reported where it is written.
    for (const { site, setter, landings } of landed) {
        const { id, weight } = setter;
        if (!weight) continue;
        const effective = effectiveIn(id, landings);
        const family =
            effective.size > 0
                ? monoAt(site, (scope) => effective.has(scope))
                : { mono: false, refs: [] };
        // Reported once, however many rules it lands in.
        const terms = weight.terms.map((term) => ({ ...term, landed: true }));
        if (family.mono) {
            const { file: from, line, name } = weight;
            findings.push(
                ...terms.map((term) => ({ file: from, line, name, ...term }))
            );
            references.push(...weight.references);
        } else if (family.refs.length > 0) {
            deferred.push({
                ...{ ...weight, terms },
                family: family.text,
                shorthand: family.shorthand,
                at: siteOf(family),
            });
        }
    }
    // A weight set from code is checked here; any other custom property it
    // sets is a definition that a stylesheet's `var()` may refer to.
    const setByCode = (name, property, index, expression) => {
        if (/^font-?weight$|^--.*weight$/i.test(property)) {
            record(name, index, analyseCode(expression));
        } else if (/^font$/i.test(property)) {
            record(name, index, analyseCode(expression, 'font'));
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
            const html = /\.(?:html|svg)$/.test(file);
            if (!insideTag(lexed, match.index, { html })) continue;
            const value = match[3] ?? match[4];
            record(match[1], match.index, analyse('weight', value));
        }
        for (const match of text.matchAll(CODE_BINDING)) {
            setByCode(match[1], match[2], match.index, match[4]);
        }
        for (const match of text.matchAll(HOST_BINDING)) {
            const [label, , target, property] = match;
            if (target === 'attr' && property !== 'font-weight') continue;
            const end = match.index + label.length;
            // A getter's value is whatever any `return` in its body gives.
            const getter = HOST_GETTER.exec(text.slice(end));
            if (getter) {
                const open = end + getter[0].length - 1;
                const body = text.slice(open, closingBrace(lexed, open));
                for (const statement of body.matchAll(/\breturn\b/g)) {
                    const at = open + statement.index;
                    if (quoteAt[at] || inNestedFunction(open, at)) continue;
                    const expression = codeExpression(text, at + 6);
                    setByCode(label, property, match.index, expression);
                }
                continue;
            }
            const field = HOST_FIELD.exec(text.slice(end));
            if (!field) continue;
            const expression = codeExpression(text, end + field[0].length);
            setByCode(label, property, match.index, expression);
        }
        for (const match of text.matchAll(CODE_ASSIGNMENT)) {
            const end = match.index + match[0].length;
            const expression = codeExpression(text, end).trim();
            const operator = match[5];
            const shorthand = (match[2] ?? match[4]) === 'font';
            if (operator && !LOGICAL_ASSIGNMENT.test(operator)) {
                const value = `${operator}= ${expression}`;
                const terms = [{ value, computed: true }];
                record(match[1], match.index, { terms, references: [] });
            } else if (shorthand) {
                record(match[1], match.index, analyseCode(expression, 'font'));
            } else {
                setByCode(match[1], 'font-weight', match.index, expression);
            }
        }
        for (const match of text.matchAll(CODE_SETTER)) {
            const { skip, property } = SETTERS[match[1]];
            let at = match.index + match[0].length;
            for (let k = 0; k < skip && at < text.length; k += 1) {
                at += codeExpression(text, at, { argument: true }).length + 1;
            }
            const quoted = QUOTED_NAME.exec(text.slice(at));
            if (!quoted || !property.test(quoted[3])) continue;
            const value = at + quoted[0].length;
            const expression = codeExpression(text, value, { argument: true });
            const name = text
                .slice(match.index, at + quoted[1].length)
                .replace(/\s+/g, '');
            setByCode(name, quoted[3], match.index, expression);
        }
    }
    for (const match of text.matchAll(DEFINITION)) {
        const name = match[1];
        if (inString(match.index) || inPrelude(match.index)) continue;
        if (!stylesheet && name.startsWith('$')) continue;
        const end = match.index + match[0].length;
        const { value, selector } = valueAfter(lexed, end);
        if (selector) continue;
        // `$x: 1` right after `(` or `,` is an argument (a mixin call, a
        // `with (…)` configuration); otherwise it declares the variable.
        const argument = ['(', ','].includes(charBefore(match.index));
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
        const full = argument ? value : declarationText(lexed, end).value;
        definitions.push({
            ...{ file, line, index, name, key, value, argument, fallback },
            // The whole declaration, for a family list (`a, b`).
            full,
            important: IMPORTANT.test(full),
            // The selector of the rule it sits in, for custom properties.
            rule: blockAt.get(place.scope)?.prelude ?? null,
            selectors: selectorsOf(place.scopes),
            // The rules it belongs to in the cascade (see `rulesOf`).
            cascades: rulesOf(place.scope),
            guards: guardsAt(index),
            // Checked against the scale where it is declared (see below).
            weighted: /weight$/i.test(name),
            // An argument reaches only the mixin or function it is passed to.
            callee: argument ? calleeOf(text, index) : null,
            scope: global ? null : place.scope,
            // A `!global` assignment runs in text order, unless flow
            // control or a callable body (run when called) encloses it.
            conditional: global
                ? place.flow || place.inCallable
                : place.conditional,
            ...{ scopes: place.scopes, inCallable: place.inCallable },
            callable: place.callable,
        });
    }

    // `@property --x { initial-value: … }` gives a registered property its
    // value wherever nothing sets it; a `…weight` name is checked there.
    for (const match of stylesheet ? text.matchAll(PROPERTY_RULE) : []) {
        if (inString(match.index)) continue;
        const brace = match.index + match[0].length - 1;
        const body = text.slice(brace, blockAt.get(brace)?.end ?? brace);
        const initial = /(?<![\w-])initial-value\s*:\s*([^;}]*)/i.exec(body);
        if (!initial) continue;
        const index = brace + initial.index;
        const name = match[1];
        const value = initial[1].trim();
        // CSS ignores an invalid registration.
        if (!registrationAccepts(body, value)) continue;
        const weighted = /weight$/i.test(name);
        if (weighted) record(name, index, analyse('weight', value));
        const place = placeOf(blocks, match.index);
        definitions.push({
            ...{ file, line: lineOf(index), index, name, key: name, value },
            ...{ full: value, argument: false, fallback: false, weighted },
            ...{ important: false, callee: null, registered: true },
            // `inherits: false` gives each element the initial value.
            inherits: /(?<![\w-])inherits\s*:\s*true\b/i.test(body),
            ...{ rule: null, guards: guardsAt(match.index), scope: null },
            ...{ conditional: false, scopes: place.scopes },
            ...{ inCallable: place.inCallable, callable: place.callable },
        });
    }
    // Loop variables take every value of their list (or range), and only
    // inside the loop body (`loop`), where they shadow an outer namesake.
    const loopVariable = (name, header, value, range = null) => {
        const index = header.index;
        const brace = index + header[0].length - 1;
        const body = blockAt.get(brace);
        const place = placeOf(blocks, index);
        definitions.push({
            ...{ file, line: lineOf(index), index, name, key: identity(name) },
            ...{ value, full: value, argument: false, fallback: false },
            ...{ important: false, weighted: false, callee: null, range },
            rule: blockAt.get(place.scope)?.prelude ?? null,
            ...{ guards: guardsAt(index), scope: place.scope },
            ...{ conditional: false, scopes: place.scopes },
            ...{ inCallable: place.inCallable, callable: place.callable },
            loop: { start: brace, end: body?.end ?? brace },
        });
    };
    for (const match of stylesheet ? text.matchAll(EACH_LOOP) : []) {
        if (inString(match.index)) continue;
        const names = match[1].split(',').map((name) => name.trim());
        const columns = loopColumns(match[2].trim(), names.length);
        names.forEach((name, i) => loopVariable(name, match, columns[i]));
    }
    for (const match of stylesheet ? text.matchAll(FOR_LOOP) : []) {
        if (inString(match.index)) continue;
        const [, name, from, bound, to] = match;
        const value = `from ${from.trim()} ${bound} ${to.trim()}`;
        const range = {
            from: from.trim(),
            to: to.trim(),
            through: bound === 'through',
        };
        loopVariable(name, match, value, range);
    }

    // Sass can build a property name; one that composes to a weight name
    // (from literals, or this file's variables as they stand there) is
    // checked like one.
    const valuesAt = (variable, index) => {
        const place = placeOf(blocks, index);
        const key = identity(variable);
        const candidates = definitions.filter(
            (d) => d.key === key && !d.argument && inLoopOf(d, index)
        );
        // A loop variable takes each item of its list in turn.
        return effectiveDeclarations(
            { index, ...place },
            candidates
        ).picked.flatMap((d) =>
            d.loop
                ? d.value
                      .replace(/^\((.*)\)$/s, '$1')
                      .split(',')
                      .map(sassValue)
                : [sassValue(d.value)]
        );
    };
    // A name whose own tail ends in `weight` is checked as written above.
    for (const match of stylesheet ? text.matchAll(INTERPOLATED_NAME) : []) {
        if (inString(match.index) || inPrelude(match.index)) continue;
        if (/weight$/i.test(match[1])) continue;
        // A name that can compose to several (`font` or `font-weight`) is
        // read every way it can.
        const modes = new Set(
            composedNames(match[1], (variable) =>
                valuesAt(variable, match.index)
            )
                .filter((candidate) => WEIGHT_NAME.test(candidate))
                .map((candidate) =>
                    candidate.toLowerCase() === 'font' ? 'font' : 'weight'
                )
        );
        if (modes.size === 0) continue;
        const end = match.index + match[0].length;
        const { value, selector } = valueAfter(lexed, end);
        if (selector) continue;
        const analyses = [...modes].map((mode) => analyse(mode, value));
        const terms = new Map(
            analyses
                .flatMap((analysis) => analysis.terms)
                .map((term) => [JSON.stringify(term), term])
        );
        record(match[1], match.index, {
            terms: [...terms.values()],
            references: analyses.flatMap((analysis) => analysis.references),
        });
    }
    // This file's module mixins as a module that includes one sees them:
    // the families and weights they set at their top level, each at its
    // place in the mixin (`key`), a family with where to resolve it.
    const mixins = new Map();
    for (const block of blocks.filter((b) => b.kind === 'callable')) {
        const name = monoAt.memberOf(block.start);
        if (name !== null && !mixins.has(name)) {
            mixins.set(name, { families: [], setters: [] });
        }
    }
    const portable = new Map();
    const portableOf = (entry) => {
        if (!portable.has(entry)) {
            portable.set(entry, { ...entry, at: siteOf(entry) });
        }
        return portable.get(entry);
    };
    for (const [name, families] of monoAt.exported) {
        mixins.get(name)?.families.push(
            ...families.map(({ key, entry }) => ({
                key,
                entry: portableOf(entry),
            }))
        );
    }
    for (const { mixin, key, id, important, animated, weight } of setInMixins) {
        const own = typeof id === 'number';
        mixins.get(mixin)?.setters.push({
            ...{ key, important, animated, id: own ? `${file}:${id}` : id },
            weight: own ? (weightAt.get(id)?.() ?? null) : weight,
        });
    }
    // Where it includes another module's mixin (see `INCLUDE`): a bare
    // name runs one of this file's own where one is in scope there.
    const includes = [];
    for (const match of stylesheet ? text.matchAll(INCLUDE) : []) {
        if (inString(match.index)) continue;
        const namespace = match[1] ?? null;
        const name = match[2].replace(/_/g, '-');
        const { defs, open } = monoAt.definitionsAt(name, match.index);
        if (namespace === null && defs.length > 0 && !open) continue;
        includes.push({ index: match.index, callee: { name, namespace } });
    }
    const loads = stylesheet ? extractStylesheetLoads(source) : [];
    const calls = callSitesOf(text, blocks);
    const invocations = stylesheet ? invocationsOf(lexed) : [];
    // Each `@include` here, by position, with the families it meets (see
    // `callAt` in `familiesOf`): a parameter capped for JetBrains Mono takes
    // only the arguments of a call that meets one.
    const includeCalls = new Map();
    for (const { index, paren } of invocations) {
        if (!/^@include\b/.test(text.slice(index, index + 8))) continue;
        const { mono, families } = monoAt.callAt(index);
        includeCalls.set(index, {
            ...{ paren, mono },
            families: families.map((entry) => ({
                ...{ text: entry.text, shorthand: entry.shorthand },
                at: siteOf(entry),
            })),
        });
    }
    return {
        ...{ file, loads, declarations, findings, references, definitions },
        ...{ calls, invocations, deferred, mixins, includes, includeCalls },
        transient: Boolean(monoAt.transient),
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
    const { qualified, unqualified, imports, loadsOf, reaches } =
        sassScopes(scans);
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
    // Whether an argument is passed to `callable`, defined in `file` (see
    // `reaches` in `sassScopes`).
    const passedTo = reaches;
    // A parameter default is the value only at calls that leave it out. A
    // callable with no call in sight may be called from where the scan
    // cannot see, so its defaults count.
    const invocations = scans.flatMap(({ file, invocations: calls = [] }) =>
        calls.map((call) => ({ ...call, file }))
    );
    // A parameter that a JetBrains Mono rule caps (`capped`) takes only the
    // arguments, or default, of an `@include` that meets one (see
    // `includeCalls` in `scanWeights`); any other call is read as before.
    const includeCalls = new Map(
        scans.map(({ file, includeCalls: calls = new Map() }) => [file, calls])
    );
    const monoCalls = new Map();
    const meetsMono = (call) => {
        if (!call) return true;
        if (!monoCalls.has(call)) {
            monoCalls.set(
                call,
                call.mono ||
                    call.families.some((f) =>
                        familyIsMono(f.text, f.at, new Set(), f.shorthand)
                    )
            );
        }
        return monoCalls.get(call);
    };
    const includeAt = (file, paren) =>
        [...(includeCalls.get(file)?.values() ?? [])].find(
            (call) => call.paren === paren
        );
    const defaultUsed = new Map();
    const usesDefault = (definition, capped = false) => {
        const id = `${capped}`;
        if (!defaultUsed.has(definition)) defaultUsed.set(definition, {});
        const cached = defaultUsed.get(definition);
        if (id in cached) return cached[id];
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
        const counted = capped
            ? calls.filter((call) =>
                  meetsMono(includeCalls.get(call.file)?.get(call.index))
              )
            : calls;
        const used = calls.length === 0 || counted.some((call) => !names(call));
        cached[id] = used;
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
    // A custom property declared again, unconditionally, later in the same
    // rule (any block with its selector, see `rulesOf`) is replaced there,
    // unless only the earlier one is `!important`; in a selector list, only
    // where that holds for every selector.
    const byRule = new Map();
    for (const definition of definitions) {
        const { key, argument, cascades, code } = definition;
        if (!key.startsWith('--') || argument || code || !cascades?.length) {
            continue;
        }
        // Its rules and selector chains line up (see `rulesOf`).
        cascades.forEach((rule, i) => {
            const group = `${definition.file} ${rule} ${key}`;
            if (!byRule.has(group)) byRule.set(group, []);
            byRule
                .get(group)
                .push({ definition, chain: definition.selectors[i] });
        });
    }
    // The selector chains each definition is replaced for.
    const overridden = new Map();
    for (const group of byRule.values()) {
        for (const { definition, chain } of group) {
            const later = group.some(
                ({ definition: other }) =>
                    other.index > definition.index &&
                    !other.conditional &&
                    (other.important || !definition.important)
            );
            if (!later) continue;
            if (!overridden.has(definition))
                overridden.set(definition, new Set());
            overridden.get(definition).add(chain);
        }
    }
    const replacedFor = (definition, chains) =>
        chains.every((chain) => overridden.get(definition)?.has(chain));
    const replaced = new Set(
        [...overridden.keys()].filter((definition) =>
            replacedFor(definition, definition.selectors)
        )
    );
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
                              d.key === name &&
                              d.file === file &&
                              !d.argument &&
                              inLoopOf(d, reference.index)
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
            // A loop variable exists only inside its loop, in its file.
            if (definition.loop) {
                const here = definition.file === file;
                if (!here || !inLoopOf(definition, reference.index))
                    return false;
            }
            if (!sass && replaced.has(definition)) return false;
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
                const capped = Boolean(reference.cap);
                const passed =
                    definition.key === name &&
                    passedTo(definition, file, reference.callable) &&
                    (definition.callee.signature
                        ? usesDefault(definition, capped)
                        : !capped ||
                          meetsMono(
                              includeAt(
                                  definition.file,
                                  definition.callee.paren
                              )
                          ));
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
    // Whether a definition sets a custom property for every element the
    // reading rule styles: one in a rule every element inherits from
    // (`:root`), or in the reading rule itself, one with the same selector,
    // or a rule it is nested in (or its component's `:host`). A property set by code sits in another file
    // and is set on some element only.
    const setsFor = (definition, reference) => {
        // A registered property always has a value: its `initial-value`.
        if (definition.registered) return true;
        const own = definition.file === reference.file;
        // A condition (`@media`, `@if`, …) around the definition that does
        // not also hold around the reading declaration may leave it unset.
        const shared = own ? (reference.guards ?? []) : [];
        if ((definition.guards ?? []).some((g) => !shared.includes(g))) {
            return false;
        }
        if (own && (reference.scopes ?? []).includes(definition.scope)) {
            return true;
        }
        // The same selector written again in the file styles the same
        // elements (another file's component styles reach other ones).
        if (own && covers(definition.selectors, reference.selectors)) {
            return true;
        }
        if (reachesEverything(definition.rule, reference.rule)) return true;
        return own && plainHost(definition.rule);
    };
    // Whether a custom property can be unset where it is read, so a `var()`
    // fallback applies: no rule sets it (one that inherits sets nothing of
    // its own), one resets it, or one sets it to a value that can be invalid.
    // A property that reads itself, directly or through others
    // (`--face: var(--face)`), is in a cycle, which CSS makes invalid.
    const mayBeUnset = (reference, path = new Set()) => {
        const key = `${reference.file} ${reference.index} ${reference.name}`;
        if (path.has(key)) return true;
        path.add(key);
        const own = visibleDefinitions(reference)
            .map((definition) => ({
                definition,
                text: (definition.full ?? definition.value).trim(),
            }))
            .filter(({ text }) => !INHERITING.test(text));
        const unset =
            !own.some(({ definition }) => setsFor(definition, reference)) ||
            own.some(
                ({ definition, text }) =>
                    RESETTING.test(text) || mayBeInvalid(text, definition, path)
            );
        path.delete(key);
        return unset;
    };
    // A value is invalid when a `var()` in it reads a property that can be
    // unset and its own fallback (if any) can be invalid too.
    const mayBeInvalid = (text, at, path) =>
        familyRefs(familyParts(text), at).some(
            (ref) =>
                mayBeUnset(ref, path) &&
                (ref.fallback === null || mayBeInvalid(ref.fallback, at, path))
        );
    // How a family list (or one variable's lists) decides JetBrains Mono,
    // entry by entry in its order: `mono`, `stop` (a family that renders
    // every glyph comes first) or `open`. A variable stands for each list
    // it can hold (its `var()` fallback too where it can be unset); any
    // branch that renders Mono counts.
    const combine = (verdicts) => {
        if (verdicts.includes('mono')) return 'mono';
        const decided = verdicts.length > 0;
        return decided && verdicts.every((v) => v === 'stop') ? 'stop' : 'open';
    };
    // A custom property set on the reading rule's own elements: by a rule
    // with its selector in its file (see `selectorOf`), under no condition
    // the reader does not share, to a value of its own. It replaces what
    // those elements inherit.
    const setsOwn = (definition, reference, chains = reference.selectors) =>
        definition.file === reference.file &&
        covers(definition.selectors, chains) &&
        !INHERITING.test((definition.full ?? definition.value).trim()) &&
        (definition.guards ?? []).every((guard) =>
            (reference.guards ?? []).includes(guard)
        );
    // How near the reading rule's elements a definition sets a custom
    // property: a registered initial value lowest (it applies where nothing
    // is set), then `:root`, `body`, an enclosing rule in the reader's file
    // (the innermost nearest) and `*` on the element itself; `null` for one
    // whose place relative to them is unknown (another rule, code).
    const nearness = (definition, reference) => {
        if (definition.registered) return 0;
        const depth = reachDepth(definition.rule, reference.rule);
        if (depth !== null) return depth;
        const own = definition.file === reference.file;
        const at = own
            ? (reference.scopes ?? []).indexOf(definition.scope)
            : -1;
        return at > 0 ? 3 - at / 1000 : null;
    };
    // The definitions that can still apply once the nearest one set
    // unconditionally to a value of its own hides the farther ones.
    // A property registered with `inherits: false` reaches no element from
    // an ancestor (`:root`, `body`, an enclosing rule): only what the element
    // sets itself (`*`, code) or the initial value.
    const nearest = (visible, reference) => {
        // An explicit `inherit` on the reader's own rule still takes the
        // parent's value (`unset` and `revert` give the initial one).
        const inherited = visible.some(
            (d) =>
                d.file === reference.file &&
                covers(d.selectors, reference.selectors) &&
                /^inherit\b/i.test((d.full ?? d.value).trim())
        );
        const local =
            !inherited && visible.some((d) => d.registered && !d.inherits);
        const ranks = visible.map((d) => nearness(d, reference));
        if (local) {
            const ancestor = (rank) => rank !== null && rank > 0 && rank < 4;
            return visible.filter((_, i) => !ancestor(ranks[i]));
        }
        const settled = visible
            .map((definition, i) => ({ definition, rank: ranks[i] }))
            .filter(({ definition, rank }) => {
                const text = (definition.full ?? definition.value).trim();
                const shared = (definition.guards ?? []).every(
                    (guard) =>
                        definition.file === reference.file &&
                        (reference.guards ?? []).includes(guard)
                );
                return rank !== null && shared && !INHERITING.test(text);
            });
        const top = Math.max(-1, ...settled.map(({ rank }) => rank));
        return visible.filter((_, i) => ranks[i] === null || ranks[i] >= top);
    };
    const refVerdict = (reference, seen) => {
        const { name, file, namespace, index, shorthand } = reference;
        const key = `${file} ${namespace ?? ''} ${index} ${name} ${shorthand}`;
        if (seen.has(key)) return 'open';
        seen.add(key);
        // A value the elements set themselves hides inherited ones, and of
        // those the nearest settled one hides the farther (see `nearest`);
        // one set from code (an inline style) may still win over either.
        const visible = visibleDefinitions(reference);
        let definitions = visible;
        if (name.startsWith('--')) {
            // Each of the reader's selectors (`.x, .y`) is its own elements:
            // a value one sets there, and not replaced there, hides what
            // those inherit, while one with none of its own inherits.
            const chains = reference.selectors ?? [];
            const ownFor = chains.map((chain) =>
                visible.filter(
                    (definition) =>
                        setsOwn(definition, reference, [chain]) &&
                        !replacedFor(definition, [chain])
                )
            );
            const inherited =
                !chains.length || ownFor.some((own) => !own.length)
                    ? nearest(visible, reference)
                    : [];
            const kept = new Set([...ownFor.flat(), ...inherited]);
            definitions = visible.filter((d) => d.code || kept.has(d));
        }
        // A value set from code holds the text of its strings.
        const verdicts = definitions.flatMap((definition) =>
            (definition.code
                ? cssOfCode(definition.value)
                : [definition.full ?? definition.value]
            ).map((text) => familyVerdict(text, definition, seen, shorthand))
        );
        if (reference.fallback !== null && mayBeUnset(reference)) {
            verdicts.push(
                familyVerdict(reference.fallback, reference, seen, shorthand)
            );
        }
        return combine(verdicts);
    };
    const familyVerdict = (text, at, seen, shorthand = false) => {
        const parts = familyParts(text);
        // A shorthand that is all variables: each holds a whole shorthand.
        if (shorthand && !hasLiteralSize(parts.outside)) {
            const list = shorthandFamilies(parts.outside);
            if (list === null || /^\s*$/.test(list)) {
                const refs = familyRefs(parts, { ...at, shorthand: true });
                return combine(refs.map((ref) => refVerdict(ref, seen)));
            }
        }
        const list = shorthand ? shorthandFamilies(text) : text;
        if (list === null) return 'open';
        for (const entry of familyEntries(list)) {
            const verdict =
                entryVerdict(entry) ?? variableVerdict(entry, at, seen);
            if (verdict !== 'open') return verdict;
        }
        return 'open';
    };
    // A variable entry: the lists its variables hold, or that Sass composes
    // from it (`'#{$prefix} Mono'`, `$a $b`).
    const variableVerdict = (entry, at, seen) => {
        const composed = /\$/.test(entry)
            ? composedFamilies(entry, at).map((t) => familyVerdict(t, at, seen))
            : [];
        const refs = familyRefs(familyParts(entry), {
            ...at,
            shorthand: false,
        });
        return combine([
            ...composed,
            ...refs.map((ref) => refVerdict(ref, seen)),
        ]);
    };
    const familyIsMono = (text, at, seen, shorthand = false) =>
        familyVerdict(text, at, seen, shorthand) === 'mono';
    // A family Sass assembles from variables (`'#{$prefix} Mono'`, `$a $b`),
    // with each variable replaced by a value it can hold (up to 16
    // combinations, through chains of any length, a cycle aside), so the
    // name is read whole. One the scan cannot resolve (a package module)
    // leaves nothing to compose.
    const composedFamilies = (text, at, path = new Set()) => {
        let results = [''];
        let last = 0;
        for (const match of text.matchAll(SASS_VALUE)) {
            const full = match[1] ?? match[2];
            const dot = full.lastIndexOf('.');
            const reference = {
                name: identity(full.slice(dot + 1)),
                namespace: dot === -1 ? null : full.slice(0, dot),
                ...{ file: at.file, index: at.index, scopes: at.scopes },
                ...{ inCallable: at.inCallable, callable: at.callable },
            };
            const values = visibleDefinitions(reference)
                .filter((definition) => !path.has(definition))
                .flatMap((definition) =>
                    composedFamilies(
                        sassValue(definition.full ?? definition.value),
                        definition,
                        new Set([...path, definition])
                    )
                );
            const between = text.slice(last, match.index);
            results = results
                .flatMap((result) => values.map((v) => result + between + v))
                .slice(0, 16);
            last = match.index + match[0].length;
        }
        return results.map((result) => result + text.slice(last));
    };
    const followed = new Set();
    const findings = [];
    for (const candidate of scans.flatMap((scan) => scan.deferred ?? [])) {
        const { family, at, shorthand } = candidate;
        if (!familyIsMono(family, at, new Set(), shorthand)) continue;
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
            // A declaration's whole value (a list `400, 650` too); an
            // argument's ends at its comma.
            const value = definition.argument
                ? definition.value
                : (definition.full ?? definition.value);
            // A shorthand that names its own family meets the Mono cap only
            // when that family can render Mono (`--f: 700 16px Roboto` read
            // where a fallback is Mono keeps its 700).
            const own = mode === 'font' ? shorthandFamilies(value) : null;
            const capHere =
                own && !rendersMono(own) && !/var\(|\$/.test(own) ? null : cap;
            const analysis = definition.range
                ? rangeAnalysis(definition)
                : definition.code
                  ? analyseCode(definition.value, mode, after, capHere)
                  : analyse(mode, value, { after, cap: capHere });
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

/**
 * Every file's scan (`sources` holds `{ file, source }`), with the mixins
 * it includes from other modules landed where it includes them: an
 * `@include ns.name`, or a bare name that `@use … as *` or `@import` brings
 * in, resolved as Sass resolves the call (see `sassScopes`). A file that
 * includes one, or whose mixin another includes, is scanned again with
 * them, after the modules it includes (Sass rejects a loop of `@use`s; a
 * file met again on one keeps its first scan).
 */
export function scanWorkspace(sources) {
    const sourceOf = new Map(sources.map(({ file, source }) => [file, source]));
    const first = new Map(
        sources.map(({ file, source }) => [file, scanWeights(file, source)])
    );
    const { reaches } = sassScopes([...first.values()]);
    const providers = [...first.values()].filter(
        (scan) => scan.mixins?.size > 0
    );
    // Each file's includes of other modules' mixins, by `@include`, with
    // the mixins each reaches; and each file's mixins others include.
    const reached = new Map();
    const elsewhere = new Map();
    for (const scan of first.values()) {
        for (const { index, callee } of scan.includes ?? []) {
            const call = { callee, file: scan.file };
            // A file's own definitions land through `familiesOf`.
            const found = providers
                .filter(({ file }) => file !== scan.file)
                .flatMap(({ file, mixins }) =>
                    [...mixins.keys()]
                        .filter((name) => reaches(call, file, name))
                        .map((name) => ({ file, name }))
                );
            // Only `@import`s can bring in two mixins of one name (anything
            // else is a Sass error), and the later one wins; the scan does
            // not order them, so it leaves such an include out.
            if (found.length !== 1) continue;
            if (!reached.has(scan.file)) reached.set(scan.file, new Map());
            reached.get(scan.file).set(index, found);
            for (const { file, name } of found) {
                if (!elsewhere.has(file)) elsewhere.set(file, new Set());
                elsewhere.get(file).add(name);
            }
        }
    }
    const done = new Map();
    const scanning = new Set();
    const scanOf = (file) => {
        if (done.has(file)) return done.get(file);
        const sites = reached.get(file) ?? new Map();
        const involved = sites.size > 0 || elsewhere.has(file);
        if (!involved || scanning.has(file)) return first.get(file);
        scanning.add(file);
        const included = new Map(
            [...sites].map(([index, found]) => [
                index,
                found.map(({ file: from, name }) =>
                    scanOf(from).mixins.get(name)
                ),
            ])
        );
        const scan = scanWeights(file, sourceOf.get(file), {
            included,
            elsewhere: elsewhere.get(file),
        });
        scanning.delete(file);
        done.set(file, scan);
        return scan;
    };
    return sources.map(({ file }) => scanOf(file));
}

/**
 * Every finding in the workspace (see `scanWorkspace`), and how many weight
 * declarations it checked. A mixin's weight landing in several JetBrains
 * Mono rules, in other modules or its own, is reported once.
 */
export function findWorkspaceWeights(sources) {
    const scans = scanWorkspace(sources);
    const all = [
        ...scans.flatMap((scan) => scan.findings),
        ...findIndirectWeights(scans),
    ];
    const keyOf = ({ file, line, name, value, cap, computed }) =>
        JSON.stringify([file, line, name, value, cap, computed]);
    const seen = new Set(all.filter((f) => !f.landed).map(keyOf));
    const findings = [];
    for (const { landed, ...finding } of all) {
        if (landed) {
            const key = keyOf(finding);
            if (seen.has(key)) continue;
            seen.add(key);
        }
        findings.push(finding);
    }
    const declarations = scans.reduce(
        (sum, scan) => sum + scan.declarations,
        0
    );
    return { declarations, findings };
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

    const sources = [];
    for (const file of files) {
        const source = await readFile(path.resolve(rootDir, file), 'utf8');
        sources.push({ file, source });
    }
    const { declarations, findings } = findWorkspaceWeights(sources);
    const diagnostics = [
        ...validateScanCoverage(files),
        ...findings.map(describeFinding),
    ];

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
