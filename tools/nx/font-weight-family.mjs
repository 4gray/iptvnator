/**
 * Which stylesheet rules render in JetBrains Mono, for the weight cap in
 * `check-font-weights.mjs`.
 */

import { inConditionPrelude, tokensOf } from './font-weight-lexer.mjs';

/** JetBrains Mono is bundled at 400 and 500 only (see `styles.scss`). */
export const MONO_WEIGHT_CAP = 500;
/**
 * The bundled face's name, matched whole (`'Not JetBrains Mono'` is not
 * it) after `familyName` reads the entry.
 */
export const MONO_FAMILY = /^jetbrains mono$/i;

const FONT_FAMILY = /(?<![\w$-])(font-family|font|family)\s*:/gi;
/**
 * A declaration's `!important`, however it is spaced or cased: CSS allows
 * whitespace and comments (blanked to spaces) after the `!`.
 */
export const IMPORTANT = /!\s*important\b/i;

/**
 * The rule a Sass nested `font: { family: …; weight: … }` block belongs
 * to, if `scope` (from `placeOf`) is one; `undefined` otherwise. Its
 * declarations compile to `font-family`/`font-weight` on that rule.
 */
export function fontNamespaceRule(blocks, { scope, scopes }) {
    const block = blocks.find((b) => b.start === scope);
    if (!block || !/^font\s*:/i.test(block.prelude)) return undefined;
    return scopes[1] ?? null;
}
/** At-rules whose body styles the enclosing rule's own element. */
const SAME_ELEMENT = /^@(?:media|supports|container|layer|include)\b/i;
const NONE = Object.freeze({ mono: false, refs: [] });
/** A family met in another module, which the scan of this one cannot read. */
const OUTSIDE = Object.freeze({ mono: false, refs: [] });

/**
 * A declaration's whole value, to its `;`: a family list is comma-separated.
 * A Sass `#{…}` (or template `${…}`) interpolation is part of it; `selector`
 * means a `{` came first.
 */
export function declarationText({ text, quoteAt }, start) {
    let end = start;
    let interpolation = 0;
    for (; end < text.length; end += 1) {
        if (quoteAt[end]) continue;
        if ('#$'.includes(text[end]) && text[end + 1] === '{') {
            interpolation += 1;
            end += 1;
        } else if (text[end] === '}' && interpolation > 0) {
            interpolation -= 1;
        } else if (';{}'.includes(text[end])) {
            break;
        }
    }
    return { value: text.slice(start, end), selector: text[end] === '{' };
}

/**
 * A `font` size, alone or with its `/line-height`: a length or percentage
 * (a unitless number is a weight, `0` aside), a keyword or a function.
 */
const FONT_SIZE =
    /^(?:[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-z]+|%)|0|(?:xx?x?-)?(?:small|large)|medium|smaller|larger|[a-z-]+\(.*\))(?:\/.*)?$/i;
/** `font` values that parse without a size and a family. */
const FONT_KEYWORD =
    /^(?:inherit|initial|unset|revert|revert-layer|caption|icon|menu|message-box|small-caption|status-bar)$/i;

/**
 * Whether a `font` shorthand parses, and so replaces the rule's earlier
 * weight: a keyword, or a size followed by a family. One with `var()` or a
 * Sass value is only checked once substituted, so it counts (at computed
 * time an invalid one inherits the weight instead).
 */
export function parsesAsFont(value) {
    const text = value.replace(IMPORTANT, '').trim();
    if (/var\(|\$|#\{/.test(text) || FONT_KEYWORD.test(text)) return true;
    const tokens = tokensOf(text);
    const size = tokens.findIndex((token) => FONT_SIZE.test(token));
    const family = tokens
        .slice(size + 1)
        .some((token) => token !== '/' && !/^[\d.]/.test(token));
    return size !== -1 && family;
}

/**
 * Families that render every glyph the UI shows: Roboto (bundled with
 * Latin, Cyrillic and Greek) and the text generics. DM Sans is Latin-only,
 * and `emoji`, `math` or `fangsong` cover special scripts, so ordinary
 * Russian or Greek text falls through them to the next family. A generic
 * is a keyword: quoted (`'monospace'`), it names a family nobody has.
 */
const BUNDLED = /^roboto$/i;
const GENERIC = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i;

/**
 * A CSS escape at `text[i]` (a `\`): what it stands for and how many
 * characters it spans. Up to six hex digits (and one whitespace after them)
 * give a code point; a line break continues a string; any other character
 * stands for itself. `null` when it cannot appear here (a line break
 * outside a string).
 */
function escapeAt(text, i, quoted) {
    const hex = /^([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?/i.exec(text.slice(i + 1));
    if (hex) {
        // Past the last code point it is U+FFFD (`fromCodePoint` throws).
        const code = Number.parseInt(hex[1], 16);
        const char = code > 0x10ffff ? '\uFFFD' : String.fromCodePoint(code);
        return [char, hex[0].length + 1];
    }
    const lineBreak = /^(?:\r\n|[\n\r\f])/.exec(text.slice(i + 1));
    if (lineBreak) return quoted ? ['', lineBreak[0].length + 1] : null;
    return [text[i + 1] ?? '', 2];
}

/**
 * The family an entry names, as the browser reads it: a string's text, or
 * its identifiers joined by single spaces, escapes decoded (`\4a etBrains
 * Mono`, `JetBrains\ Mono`). `quoted` says it was a string; `null` when
 * the entry is not one name (`'JetBrains' Mono`, an unclosed string).
 */
function familyName(entry) {
    const text = entry.trim();
    const quote = /^['"]/.test(text) ? text[0] : '';
    const words = [];
    let word = '';
    for (let i = quote ? 1 : 0; i < text.length; i += 1) {
        const char = text[i];
        if (char === '\\') {
            const escape = escapeAt(text, i, Boolean(quote));
            if (!escape) return null;
            word += escape[0];
            i += escape[1] - 1;
        } else if (quote && char === quote) {
            return i === text.length - 1 ? { name: word, quoted: true } : null;
        } else if (!quote && /\s/.test(char)) {
            if (word) words.push(word);
            word = '';
        } else {
            word += char;
        }
    }
    if (quote) return null;
    return { name: [...words, word].filter(Boolean).join(' '), quoted: false };
}

/**
 * Whether a `font` shorthand has a literal size, so a variable after it
 * holds family names rather than the whole shorthand.
 */
export function hasLiteralSize(value) {
    return tokensOf(value).some(
        (token) => FONT_SIZE.test(token) && !/^var\(/i.test(token)
    );
}

/** What can come before a shorthand's size: weight, style, variant, width. */
const SHORTHAND_PREFIX =
    /^(?:\d+|normal|italic|oblique|small-caps|bold|bolder|lighter|(?:ultra-|extra-|semi-)?(?:condensed|expanded))$/i;

/**
 * An operand of a static Sass interpolation: a string (its escapes kept,
 * for the name to decode as it does its own), word or number.
 */
const STATIC_OPERAND = String.raw`(?:'(?:[^'\\]|\\[\s\S])*'|"(?:[^"\\]|\\[\s\S])*"|[a-z_][\w-]*|\d[\w.%]*)`;

const STATIC_INTERPOLATION = new RegExp(
    String.raw`#\{\s*(${STATIC_OPERAND}(?:\s*\+?\s*${STATIC_OPERAND})*)\s*\}`,
    'gi'
);

/**
 * Text with each static Sass interpolation written out as Sass does:
 * strings unquoted, operands spaced or joined by `+`, `null` as nothing
 * (`#{'Jet' + 'Brains'} Mono` is `JetBrains Mono`). One that reads a
 * variable or calls a function stays, for its value to decide.
 */
export function staticInterpolated(text) {
    return text.replace(STATIC_INTERPOLATION, (match, expression) => {
        const values = [];
        // Operands a `+` joins concatenate; others are spaced, as a list.
        let joined = false;
        const operand = new RegExp(STATIC_OPERAND, 'iy');
        for (let i = 0; i < expression.length;) {
            if (/\s/.test(expression[i])) {
                i += 1;
                continue;
            }
            if (expression[i] === '+') {
                joined = true;
                i += 1;
                continue;
            }
            operand.lastIndex = i;
            const [token] = operand.exec(expression);
            const value = /^['"]/.test(token)
                ? token.slice(1, -1)
                : /^null$/i.test(token)
                  ? ''
                  : token;
            if (joined && values.length) values[values.length - 1] += value;
            else values.push(value);
            joined = false;
            i += token.length;
        }
        return values.filter(Boolean).join(' ');
    });
}

/**
 * One family entry, decided outright: `mono` (JetBrains Mono), `stop` (a
 * family that renders every glyph), `open` (another face), or `null` for a
 * variable (`var(…)`, `$x`, `#{…}`) whose value decides. A static `#{…}`
 * reads as the text it writes out.
 */
export function entryVerdict(written) {
    const entry = staticInterpolated(written);
    // In a string, only a Sass `#{…}` is a variable: `"var(--x)"` and
    // `"$x"` are names.
    const quoted = /^\s*['"]/.test(entry);
    if (quoted ? entry.includes('#{') : /var\(|\$|#\{/i.test(entry)) {
        return null;
    }
    const family = familyName(entry);
    if (!family) return 'open';
    if (MONO_FAMILY.test(family.name)) return 'mono';
    if (BUNDLED.test(family.name)) return 'stop';
    if (!family.quoted && GENERIC.test(family.name)) return 'stop';
    return 'open';
}

/** A family list's entries, split at its top-level commas. */
export function familyEntries(list) {
    return selectorsOf(list.replace(IMPORTANT, ''));
}

/**
 * The family list of a `font` shorthand: what follows its size and
 * `/line-height`, or `null` when it has no size.
 */
export function shorthandFamilies(value) {
    const tokens = tokensOf(value.replace(IMPORTANT, ''));
    // A literal size first; `var()` (or its placeholder) only when none.
    const size = tokens.findIndex(
        (token) => FONT_SIZE.test(token) && !/^var\(/i.test(token)
    );
    // Without one, the family starts at the first literal name or entry
    // that a comma ends, else at the last token, and the size is the token
    // before it (`var(--weight) var(--size) 'JetBrains Mono'`).
    if (size === -1) {
        let start = tokens.findIndex(
            (token, i) =>
                i > 0 &&
                (token.endsWith(',') ||
                    tokens[i + 1] === ',' ||
                    (!/^[\d./]/.test(token) &&
                        !SHORTHAND_PREFIX.test(token) &&
                        entryVerdict(token) !== null))
        );
        if (start === -1) start = tokens.length - 1;
        return start < 1 ? null : tokens.slice(start).join(' ');
    }
    let rest = tokens.slice(size + 1);
    if (rest[0] === '/') rest = rest.slice(2);
    else if (rest[0]?.startsWith('/')) rest = rest.slice(1);
    return rest.join(' ');
}

/**
 * Whether JetBrains Mono can render a family list: it is named before any
 * family that always resolves (a bundled face such as Roboto, or an
 * unquoted generic such as `monospace`). A face only some systems have (`ui-monospace`,
 * `'SF Mono'`) leaves it in play. In a `font` shorthand the list follows
 * the size and its `/line-height`.
 */
export function rendersMono(
    written,
    { shorthand = false, defer = false } = {}
) {
    const value = staticInterpolated(written);
    const list = shorthand ? shorthandFamilies(value) : value;
    if (list === null) return false;
    for (const entry of familyEntries(list)) {
        const verdict = entryVerdict(entry.replace(/\bvar\(\)/g, 'var('));
        // A variable decides in its place; with `defer`, leave it to the
        // workspace-wide resolution rather than skip past it.
        if (verdict === null) {
            if (defer) return false;
            continue;
        }
        if (verdict !== 'open') return verdict === 'mono';
    }
    return false;
}

/** Where the string opening at `value[start]` ends (past its quote). */
function stringEnd(value, start) {
    for (let i = start + 1; i < value.length; i += 1) {
        if (value[i] === '\\') i += 1;
        else if (value[i] === value[start]) return i + 1;
    }
    return value.length;
}

/**
 * A family value split into what it names outright (`outside`) and the
 * custom properties it reads (`vars`), each with the fallback that applies
 * only where the property is never set: `var(--face, 'JetBrains Mono')`.
 */
export function familyParts(value) {
    const vars = [];
    let outside = '';
    let i = 0;
    while (i < value.length) {
        // A string is a name, whatever it spells (`"var(--x)"`).
        if (value[i] === '"' || value[i] === "'") {
            const end = stringEnd(value, i);
            outside += value.slice(i, end);
            i = end;
            continue;
        }
        const open = /^var\(\s*(--[\w-]+)\s*(,)?/i.exec(value.slice(i));
        if (!open) {
            outside += value[i];
            i += 1;
            continue;
        }
        let end = i + open[0].length;
        for (let depth = 1; end < value.length && depth > 0; end += 1) {
            if (value[end] === '"' || value[end] === "'") {
                end = stringEnd(value, end) - 1;
            } else if (value[end] === '(') depth += 1;
            else if (value[end] === ')') depth -= 1;
        }
        const fallback = open[2]
            ? value.slice(i + open[0].length, end - 1)
            : null;
        vars.push({ name: open[1], fallback });
        // A placeholder keeps the token's place (a shorthand's size).
        outside += 'var()';
        i = end;
    }
    return { outside, vars };
}

/**
 * A selector (or family) list split at its top-level commas: `:is(a, b)`,
 * `'a, b'` and `a\, b` stay whole.
 */
export function selectorList(prelude) {
    return selectorsOf(prelude);
}

function selectorsOf(prelude) {
    const selectors = [];
    let depth = 0;
    let quote = '';
    let current = '';
    for (let i = 0; i < prelude.length; i += 1) {
        const char = prelude[i];
        // An escaped character, or one in a string, is text.
        if (char === '\\') {
            current += prelude.slice(i, i + 2);
            i += 1;
            continue;
        }
        if (quote) {
            if (char === quote) quote = '';
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
        }
        if (char === ',' && depth === 0 && !quote) {
            selectors.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    return [...selectors, current.trim()];
}

/**
 * How near the elements a reading rule styles a rule that reaches every
 * element sets its custom properties: `:root`/`html` at the top (1), `body`
 * below it (2), `*` on each element itself (4); `null` for any other rule (a
 * component's `:host` reaches only its own view). `body` sits below `html`,
 * so it cannot pass a property up to a `:root` reader.
 */
export function reachDepth(prelude, reader = null) {
    if (!prelude) return null;
    // One that targets the root element (`html.dark`, `:root:not(.x)`).
    const rootReader = reader
        ? rootSelectors(reader).some((s) =>
              /^(?::root|html)(?![\w-])/i.test(
                  compoundsOf(s).at(-1)?.compound ?? ''
              )
          )
        : false;
    const depths = rootSelectors(prelude).map((selector) => {
        if (selector === '*') return 4;
        if (/^body$/i.test(selector)) return rootReader ? null : 2;
        return /^(?::root|html)$/i.test(selector) ? 1 : null;
    });
    const reached = depths.filter((depth) => depth !== null);
    return reached.length ? Math.max(...reached) : null;
}

/** Whether a rule's custom properties reach every element (`reachDepth`). */
export function reachesEverything(prelude, reader = null) {
    return reachDepth(prelude, reader) !== null;
}

/**
 * A selector's compounds, each with the combinator before it (`.a .b > .c`
 * is `.a`, ` ` `.b`, `>` `.c`), split outside brackets, parentheses,
 * strings and escapes.
 */
function compoundsOf(selector) {
    const parts = [];
    let compound = '';
    let combinator = '';
    let depth = 0;
    let quote = '';
    for (let i = 0; i < selector.length; i += 1) {
        const char = selector[i];
        if (char === '\\') {
            compound += selector.slice(i, i + 2);
            i += 1;
        } else if (quote || depth > 0 || !/[\s>+~]/.test(char)) {
            if (quote && char === quote) quote = '';
            else if (!quote && (char === '"' || char === "'")) quote = char;
            else if (!quote && '(['.includes(char)) depth += 1;
            else if (!quote && ')]'.includes(char)) depth -= 1;
            compound += char;
        } else {
            // Whitespace alone is the descendant combinator.
            if (compound) parts.push({ combinator, compound });
            if (compound) combinator = ' ';
            if (!/\s/.test(char)) combinator = char;
            compound = '';
        }
    }
    if (compound) parts.push({ combinator, compound });
    return parts;
}

/** Selector text from its compounds, spaced one way (`.a>.b` is `.a > .b`). */
function joined(parts) {
    return parts
        .map(({ combinator, compound }, k) => {
            if (combinator === ' ') return ` ${compound}`;
            if (!combinator) return compound;
            return `${k ? ' ' : ''}${combinator} ${compound}`;
        })
        .join('');
}

/**
 * One simple selector: a type or `*`, class, id, attribute or pseudo (a
 * functional one's argument read to its balanced `)`, however nested).
 */
const SIMPLE =
    /\*|[a-z][\w-]*|\.(?:\\.|[\w-])+|#(?:\\.|[\w-])+|\[[^\]]*\]|::?[\w-]+/iy;

/** Where the `(` at `open` closes (past its `)`), or -1; strings skipped. */
function closingParen(text, open) {
    let depth = 0;
    let quote = '';
    for (let i = open; i < text.length; i += 1) {
        const char = text[i];
        if (char === '\\') i += 1;
        else if (quote) {
            if (char === quote) quote = '';
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '(') depth += 1;
        else if (char === ')' && (depth -= 1) === 0) return i + 1;
    }
    return -1;
}

/**
 * A compound's simple selectors (`a.x:hover` is `a`, `.x`, `:hover`), or
 * `null` for one this cannot split: a Sass `&` or interpolation, or more
 * than one compound.
 */
function simplesOf(compound) {
    const simples = [];
    SIMPLE.lastIndex = 0;
    while (SIMPLE.lastIndex < compound.length) {
        const start = SIMPLE.lastIndex;
        const match = SIMPLE.exec(compound);
        if (!match) return null;
        if (match[0].startsWith(':') && compound[SIMPLE.lastIndex] === '(') {
            const end = closingParen(compound, SIMPLE.lastIndex);
            if (end === -1) return null;
            SIMPLE.lastIndex = end;
        }
        simples.push(compound.slice(start, SIMPLE.lastIndex));
    }
    return simples;
}

const ATTRIBUTE =
    /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s'"\]]+))\s*)?\]$/;

/**
 * A simple selector as the elements it matches, spelled one way for
 * comparing (not ranking): a type lowercased, an attribute's quotes and
 * spaces dropped, and `[class~=x]` read as `.x` and `[id=x]` as `#x`. A
 * type is lowercased even for SVG (`foreignObject`): Chromium, the app's
 * Electron runtime, matches it so in an HTML document, where WebKit and
 * Firefox match an SVG element's case exactly.
 */
function matchKey(simple) {
    const attribute = ATTRIBUTE.exec(simple);
    if (!attribute) {
        return /^[a-z][\w-]*$/i.test(simple) ? simple.toLowerCase() : simple;
    }
    const [, written, operator, double, single, bare] = attribute;
    const name = written.toLowerCase();
    if (!operator) return `[${name}]`;
    const value = double ?? single ?? bare;
    const word = /^[\w-]+$/.test(value);
    if (word && name === 'class' && operator === '~=') return `.${value}`;
    if (word && name === 'id' && operator === '=') return `#${value}`;
    return `[${name}${operator}${JSON.stringify(value)}]`;
}

/** A functional pseudo-class and its argument (`:is(.x, .y)`). */
const FUNCTIONAL = /^:([\w-]+)\(([\s\S]*)\)$/;

/**
 * A selector's specificity as `[ids, classes, types]`: `:where()` counts
 * nothing, `:is()`, `:not()` and `:has()` their most specific argument.
 */
export function specificityOf(selector) {
    const total = [0, 0, 0];
    for (const { compound } of compoundsOf(selector)) {
        for (const simple of simplesOf(compound) ?? []) {
            const [, name, argument] = FUNCTIONAL.exec(simple) ?? [];
            let add = [0, 0, 0];
            const of = /^nth-(?:last-)?child$/i.test(name ?? '')
                ? /\sof\s+([\s\S]+)$/i.exec(argument)?.[1]
                : undefined;
            if (/^(?:is|not|has|matches)$/i.test(name ?? '') || of) {
                add = selectorsOf(of ?? argument)
                    .map(specificityOf)
                    .reduce((a, b) => (compare(a, b) >= 0 ? a : b), [0, 0, 0]);
                // `:nth-child(… of S)` is a pseudo-class as well as `S`.
                if (of) add = [add[0], add[1] + 1, add[2]];
            } else if (/^where$/i.test(name ?? '') || simple === '*') {
                add = [0, 0, 0];
            } else if (simple.startsWith('#')) add = [1, 0, 0];
            else if (
                /^::|^:(?:before|after|first-line|first-letter)$/i.test(simple)
            ) {
                add = [0, 0, 1];
            } else if (/^[.:[]/.test(simple)) add = [0, 1, 0];
            else add = [0, 0, 1];
            for (let k = 0; k < 3; k += 1) total[k] += add[k];
        }
    }
    return total;
}

/** A declaration's importance: an animation's outranks a normal one. */
const IMPORTANT_LEVEL = 2;
export function levelOf(declaration) {
    if (!declaration) return -1;
    if (declaration.important) return IMPORTANT_LEVEL;
    return declaration.animated ? 1 : 0;
}

/** Whether cascade rank `a` beats `b` (a later equal rank wins). */
function rankAbove(a, b) {
    if (a.important !== b.important) return a.important > b.important;
    const layer = ordered(a.layer, b.layer);
    if (layer) return a.important === IMPORTANT_LEVEL ? layer < 0 : layer > 0;
    const specificity = compare(a.specificity, b.specificity);
    if (specificity) return specificity > 0;
    return a.order > b.order;
}

/**
 * How two layer places compare, level by level: each ends in `Infinity`,
 * so two that differ do so before the shorter one ends.
 */
function ordered(a, b) {
    for (let k = 0; k < Math.min(a.length, b.length); k += 1) {
        if (a[k] !== b[k]) return a[k] > b[k] ? 1 : -1;
    }
    return 0;
}

/** Which of two specificities is greater (positive), equal (0) or less. */
function compare(a, b) {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * The ways a compound's simple selectors can be read with `:is()` and
 * `:where()` opened (`:is(.x, .y).z` is `.x .z` or `.y .z`), up to 16.
 */
function alternativesOf(simples) {
    let ways = [[]];
    for (const simple of simples) {
        const [, name, argument] = FUNCTIONAL.exec(simple) ?? [];
        // Each argument opens in turn (`:is(:where(.x))` is `.x`).
        const options = /^(?:is|where|matches)$/i.test(name ?? '')
            ? selectorsOf(argument).flatMap((s) => {
                  const inner = simplesOf(s);
                  return inner ? alternativesOf(inner) : [null];
              })
            : [[simple]];
        if (options.some((option) => !option)) return [simples];
        ways = ways.flatMap((way) => options.map((o) => [...way, ...o]));
        if (ways.length > 16) return [simples];
    }
    return ways;
}

/**
 * The complex selectors a selector reads as with its `:is()`/`:where()`
 * opened, in turn and up to 16: in any compound when they hold compounds
 * (`.x :where(.p) .c` is `.x .p .c`), and alone as a first compound or
 * after a descendant combinator also when they hold whole selectors
 * (`.x :is(.a .b)` reads as `.x .a .b`, elements it matches all); after
 * `>`, `+` or `~` a whole selector would name others, so it stays.
 */
function complexOf(selector) {
    let ways = [[]];
    for (const [k, part] of compoundsOf(selector).entries()) {
        const simples = simplesOf(part.compound);
        const spliced = (k === 0 || part.combinator === ' ') && simples;
        const whole = spliced ? simples.filter(holdsSelectors) : [];
        const options =
            whole.length === 1
                ? splicedWith(whole[0], simples, part.combinator)
                : (simples ? alternativesOf(simples) : [[part.compound]]).map(
                      (way) => [{ ...part, compound: way.join('') }]
                  );
        ways = ways.flatMap((way) => options.map((o) => [...way, ...o]));
        if (ways.length > 16) return [canonicalSelector(selector)];
    }
    return ways.map(joined);
}

/**
 * Whether a simple is an `:is()`/`:where()` holding a whole selector, also
 * through others nested in it (`:where(:is(.p .c))`).
 */
function holdsSelectors(simple) {
    const [, name, argument] = FUNCTIONAL.exec(simple) ?? [];
    return (
        /^(?:is|where|matches)$/i.test(name ?? '') &&
        selectorsOf(argument)
            .flatMap(complexOf)
            .some((s) => compoundsOf(s).length > 1)
    );
}

/**
 * The compounds `simple` (one holding whole selectors) opens into, the
 * compound's other simples joining each selector's last compound
 * (`:where(.p .c).active` is `.p .c.active`).
 */
function splicedWith(simple, simples, combinator) {
    const [, , argument] = FUNCTIONAL.exec(simple);
    const rest = alternativesOf(simples.filter((s) => s !== simple));
    return selectorsOf(argument)
        .flatMap(complexOf)
        .flatMap((inner) =>
            rest.flatMap((others) => {
                const parts = compoundsOf(inner);
                const last = parts.at(-1);
                const own = simplesOf(last.compound);
                if (!own) return [];
                // A type leads the compound, and `*` gives way to the rest.
                const merged = [...new Set([...own, ...others])];
                const all =
                    merged.length > 1
                        ? merged.filter((s) => s !== '*')
                        : merged;
                const types = all.filter((s) => /^[a-z][\w-]*$/i.test(s));
                const compound = [
                    ...types,
                    ...all.filter((s) => !types.includes(s)),
                ].join('');
                const spliced = [...parts.slice(0, -1), { ...last, compound }];
                return [spliced.map((c, i) => (i ? c : { ...c, combinator }))];
            })
        );
}

/**
 * An at-rule prelude spaced and cased one way, so conditions written
 * differently compare equal (`@MEDIA (min-width:1px)` is `@media
 * (min-width: 1px)`): its name lowercased, no space around `(`, `)`, `:`
 * or `,`, and one space elsewhere; a quoted string kept as written.
 */
function conditionKey(prelude) {
    return prelude
        .replace(/^@[\w-]+/, (name) => name.toLowerCase())
        .split(/("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')/)
        .map((part, k) =>
            k % 2
                ? part
                : part.replace(/\s+/g, ' ').replace(/\s*([():,])\s*/g, '$1')
        )
        .join('')
        .trim();
}

/**
 * Whether a rule in context `outer` applies wherever one in `inner` does:
 * each of its conditions (at-rule wrappers, `@if`/`@each` blocks) is one
 * of the inner one's too (an unconditional rule applies everywhere).
 */
function encloses(outer, inner) {
    const parts = (context) =>
        context.split(' | ').map((list, k) => {
            if (!list) return [];
            return list.split(k === 0 ? ' ; ' : ' ');
        });
    const [a, b] = [parts(outer), parts(inner)];
    return a.every((list, k) => list.every((part) => b[k].includes(part)));
}

/** A selector spaced one way, so `.a>.b` and `.a > .b` compare equal. */
export function canonicalSelector(selector) {
    return joined(compoundsOf(selector));
}

/**
 * The ancestors a selector names for the element it targets, nearest
 * first: `.a .b > .c` has `.a .b` and `.a`. A compound followed by `+` or
 * `~` is a sibling, so `.a .b + .c` has only `.a`.
 */
export function ancestorsOf(selector) {
    const parts = compoundsOf(selector);
    const ancestors = [];
    for (let i = parts.length - 2; i >= 0; i -= 1) {
        if (/^[ >]$/.test(parts[i + 1].combinator)) {
            ancestors.push(joined(parts.slice(0, i + 1)));
        }
    }
    return ancestors;
}

/** A selector list with `:where(…)` and `:is(…)` wrappers opened. */
function rootSelectors(prelude) {
    return selectorsOf(prelude).flatMap((selector) => {
        const wrapped = /^:(?:where|is)\((.*)\)$/i.exec(selector);
        return wrapped ? rootSelectors(wrapped[1]) : [selector];
    });
}

/**
 * Whether a rule is a component's plain `:host`, which reaches its whole
 * view; `:host(.light)` applies only in that state.
 */
export function plainHost(prelude) {
    if (!prelude) return false;
    return selectorsOf(prelude).some((selector) => /^:host$/i.test(selector));
}

/**
 * Whether a nested rule styles its parent's element or a descendant, which
 * inherit the parent's family: `&:hover`, `.child`, `> .child`, or a
 * `@media` or `@include` body. A `&-suffix` class and a `+`/`~` sibling are
 * other elements, unless the sibling is the parent's own kind again (`& + &`
 * targets `.x + .x`, an `.x`); any other at-rule (a mixin body included
 * elsewhere) is set where it runs.
 */
function inherits(prelude) {
    if (prelude.startsWith('@')) return SAME_ELEMENT.test(prelude);
    return selectorsOf(prelude).some((selector) => {
        const target = selector
            .split(/\s*[>+~]\s*|\s+/)
            .filter(Boolean)
            .at(-1);
        if (/^&(?![\w-])/.test(target ?? '')) return true;
        return !/^&[\w-]/.test(selector) && !/^&?\s*[+~]/.test(selector);
    });
}

/**
 * What an `@at-root` block leaves out of the blocks around it, by kind
 * (`rule` for a style rule, else the at-rule's name): style rules by
 * default and for a selector without `&`, nothing for one with `&`,
 * those `(without: …)` names (`all` for every block), or all but those
 * `(with: …)` names; `null` for another block.
 */
export function atRootExcludes(prelude) {
    const atRoot = /^@at-root\b\s*([\s\S]*)$/i.exec(prelude);
    if (!atRoot) return null;
    const rest = atRoot[1].trim();
    const query = /^\(\s*(with|without)\s*:\s*([^)]*)\)/i.exec(rest);
    if (!query)
        return rest.includes('&') ? () => false : (kind) => kind === 'rule';
    const names = query[2].trim().toLowerCase().split(/\s+/);
    const listed = (kind) => names.includes('all') || names.includes(kind);
    return query[1].toLowerCase() === 'without'
        ? listed
        : (kind) => !listed(kind);
}

/** A block's kind for `atRootExcludes`: `rule`, or its at-rule's name. */
export function blockKind(prelude) {
    return /^@([\w-]+)/.exec(prelude)?.[1].toLowerCase() ?? 'rule';
}

/**
 * The selector a block styles: its prelude, or an `@at-root`'s own
 * (`@at-root .x`); `null` for any other at-rule.
 */
function styleSelector(block) {
    const atRoot = /^@at-root\b\s*([\s\S]*)$/i.exec(block.prelude);
    if (atRoot) {
        const selector = atRoot[1].trim();
        return selector && !selector.startsWith('(') ? selector : null;
    }
    return block.prelude.startsWith('@') ? null : block.prelude;
}

/** An `@extend` of whole selectors (`%mono`, `.a, .b`), `!optional` aside. */
const EXTEND = /@extend\s+([^;{}!]+?)\s*(?:!\s*optional\s*)?[;}]/gi;

/**
 * The `all` shorthand set to a CSS-wide keyword: it resets the family too,
 * to the inherited one (`unset`, `inherit`, `revert`) or the browser's
 * default (`initial`).
 */
export const ALL_RESET =
    /(?<![\w$-])all\s*:\s*(initial|inherit|unset|revert|revert-layer)\s*(!\s*important\s*)?(?=[;}])/gi;

/**
 * Whether a property at `index` starts a declaration: after a `{`, `;` or
 * `}` (whitespace and blanked comments aside), not inside another value
 * (`--token: all: unset`) or a Sass map (`(all: unset)`).
 */
export function startsDeclaration(text, index) {
    let k = index - 1;
    while (k >= 0 && /\s/.test(text[k])) k -= 1;
    return k < 0 || '{;}'.includes(text[k]);
}

/** An `@include` of a mixin in this file (`ns.mixin` is another file's). */
const INCLUDE = /@include\s+([\w-]+)(?![\w.-])/g;
const CONTENT = /@content\b/g;
/** A `@keyframes` block's prelude, with its name. */
const KEYFRAMES = /^@(?:-[a-z]+-)?keyframes\s+(\S+)/i;
/** An `animation` or `animation-name` declaration. */
const ANIMATION = /(?<![\w$-])animation(?:-name)?\s*:/gi;
/** An animation value that keeps a frame once it runs. */
const HOLDS = /(?<![\w-])(?:forwards|both|infinite)(?![\w-])/i;
/** A block's own longhand that keeps an animation's frame. */
const HELD =
    /(?<![\w-])animation-(?:fill-mode\s*:[^;}]*(?<![\w-])(?:forwards|both)|iteration-count\s*:[^;}]*infinite)(?![\w-])/i;
/** A keyframe declaration that sets a font. */
const FONT_IN_FRAMES = /(?<![\w$-])(?:font(?:-family|-weight)?|all)\s*:/i;
/** A token of the `animation` shorthand that is no name. */
const ANIMATION_KEYWORD =
    /^(?:none|linear|ease(?:-in|-out|-in-out)?|step-(?:start|end)|infinite|normal|reverse|alternate(?:-reverse)?|forwards|backwards|both|running|paused|initial|inherit|unset|revert(?:-layer)?)$/i;
const unquoted = (name) => name.replace(/^(['"])(.*)\1$/, '$2');

/**
 * The keyframe names an `animation` (one per layer: the token that is no
 * keyword, time, number or function) or `animation-name` value runs; a
 * name the scan cannot read (`var(--n)`, `$n`) is `null`, any of them.
 */
function animationNames(value, longhand) {
    return selectorsOf(value.replace(IMPORTANT, '')).flatMap((layer) => {
        const tokens = layer.trim().split(/\s+/).filter(Boolean);
        if (tokens.some((token) => /var\(|\$|#\{/.test(token))) return [null];
        const names = tokens
            .map(unquoted)
            .filter(
                (token) =>
                    longhand ||
                    !(
                        ANIMATION_KEYWORD.test(token) ||
                        /^[\d.+-]|[(),]/.test(token)
                    )
            );
        return longhand ? names : names.slice(0, 1);
    });
}

/** The combinators a selector's one allows across in a narrower one. */
const ACROSS = { ' ': [' ', '>'], '~': ['~', '+'] };

/**
 * How two landings (see `landingsOf`) compare in the order Sass writes
 * them out: by their place in the rule, then within each mixin and content
 * block they go through.
 */
export function keyOrder(a, b) {
    for (let k = 0; k < Math.min(a.length, b.length); k += 1) {
        if (a[k] !== b[k]) return a[k] - b[k];
    }
    return a.length - b.length;
}

/**
 * The family each rule sets (every block with one of its selector chains,
 * see `rulesOf`), the last declaration in source order winning unless an
 * earlier one is `!important`: whether it names JetBrains Mono outright (`mono`),
 * the variables it reads (`refs`, from `familyParts`, resolved later across
 * the workspace) or that it inherits (`inherit`/`unset`). Returns
 * `monoAt(index)`: the family in effect for a declaration there, from the
 * innermost rule that sets one and that the declaration's rule inherits
 * from. `@font-face` describes a face, so nothing in it is capped.
 *
 * Another module's mixin lands too: `included` gives, by the position of
 * each `@include` of one, the families its top-level declarations set
 * (`{ key, entry }`, `key` its place in that mixin), and `elsewhere` names
 * this file's module mixins that another module includes, which style
 * nothing where they are written (see `scanWorkspace`).
 */
export function familiesOf(
    lexed,
    blocks,
    { inString, placeOf, refsIn, rulesOf, transient = true },
    { included = new Map(), elsewhere = new Set() } = {}
) {
    const family = new Map();
    // This file's mixins, in source order, with the scope each is declared
    // in (`null` for the module; one declared in a rule is local to it).
    const mixins = blocks.filter(
        (b) => b.kind === 'callable' && /^@mixin\b/i.test(b.prelude)
    );
    const declaredIn = new Map(
        mixins.map((b) => [b.start, placeOf(blocks, b.start).scope])
    );
    const named = (name, scope) =>
        mixins.filter(
            (b) => b.name === name && declaredIn.get(b.start) === scope
        );
    // The outermost callable body between `scope` and `site`, if any: a
    // site in one runs where that callable is included, not where it is.
    const deferredBy = (scope, site) =>
        blocks.find(
            (b) =>
                b.kind === 'callable' &&
                b.start < site &&
                site < b.end &&
                (scope === null || b.start > scope)
        ) ?? null;
    // When a site runs, as places in the module's own run: itself outside
    // any mixin body, else where each `@include` of the mixin it sits in
    // runs, and the module's end (`Infinity`) where another module includes
    // it or nothing here does.
    const runsAt = (site, seen = new Set()) => {
        const callable = deferredBy(null, site);
        if (!callable) return [site];
        if (seen.has(callable.start)) return [];
        const scope = declaredIn.get(callable.start);
        if (scope === undefined) return [Infinity];
        const next = new Set([...seen, callable.start]);
        const sites = (includes.get(callable.name) ?? []).filter((t) =>
            placeOf(blocks, t).scopes.includes(scope)
        );
        const outside =
            elsewhere.has(memberOf(callable.start)) ||
            (sites.length === 0 && scope === null);
        return [
            ...sites.flatMap((t) => runsAt(t, next)),
            ...(outside ? [Infinity] : []),
        ];
    };
    // The definition of `name` an `@include` at `site` runs when the module
    // has run to `point` (see `runsAt`), as Sass resolves it: in the
    // innermost scope around the site that has declared one by then, the
    // last; in a mixin body declared in a rule or another mixin, any.
    const resolveAt = (name, site, point) => {
        for (const scope of placeOf(blocks, site).scopes) {
            const declared = named(name, scope);
            if (declared.length === 0) continue;
            const deferred = deferredBy(scope, site) !== null;
            if (deferred && scope !== null) return declared;
            const by = deferred ? point : site;
            const ran = declared.filter((b) => b.start < by).slice(-1);
            if (ran.length > 0) return ran;
        }
        return [];
    };
    // The definitions an `@include` of `name` at `site` can run, wherever
    // it runs (`defs`), and whether somewhere none of this file's is in
    // scope (`open`), so one another module brings in runs.
    const definitions = new Map();
    const definitionsAt = (name, site) => {
        const id = `${name} ${site}`;
        if (!definitions.has(id)) {
            const each = runsAt(site).map((point) =>
                resolveAt(name, site, point)
            );
            definitions.set(id, {
                defs: [...new Set(each.flat())],
                open: each.some((found) => found.length === 0),
            });
        }
        return definitions.get(id);
    };
    // Whether the definitions a landing went through (`{ name, site, def }`,
    // `def` `null` for another module's) are the ones that run when the
    // module has run to `point`.
    const ranAt = (checks, point) =>
        checks.every(({ name, site, def }) => {
            const found = resolveAt(name, site, point);
            return def === null ? found.length === 0 : found.includes(def);
        });
    // A module mixin's name, for its last module-level definition: the one
    // another module includes (one declared in a rule never is).
    const memberOf = (scope) => {
        const block = mixins.find((b) => b.start === scope);
        if (!block) return null;
        const last = mixins
            .filter((b) => b.name === block.name)
            .filter((b) => declaredIn.get(b.start) === null)
            .at(-1);
        return last === block ? block.name : null;
    };
    // This file's `@include` sites, by mixin: a declaration in a mixin's
    // body lands in the rule that includes it, at the `@include`.
    const includes = new Map();
    for (const match of lexed.text.matchAll(INCLUDE)) {
        if (inString(match.index)) continue;
        const name = match[1].replace(/_/g, '-');
        if (!includes.has(name)) includes.set(name, []);
        includes.get(name).push(match.index);
    }
    // Only a mixin is included (a function's body sets nothing), where the
    // name runs this definition of it.
    const sitesOf = (scope) => {
        const block = mixins.find((b) => b.start === scope);
        if (!block) return [];
        return (includes.get(block.name) ?? []).filter((site) =>
            definitionsAt(block.name, site).defs.includes(block)
        );
    };
    // A content block (`@include m { … }`) passed to a mixin of this file
    // that places `@content` at its top level is the including rule's
    // there: its declarations land at the `@include`, in order where each
    // `@content` sits in `m`. One placed deeper (in a nested rule or
    // `@media`) is not traced, as the mixin's own nested blocks are not.
    const contentOf = (scope) => {
        const block = blocks.find((b) => b.start === scope);
        const named = /^@include\s+([\w-]+)(?![\w.-])/i.exec(
            block?.prelude ?? ''
        );
        if (!named) return null;
        const name = named[1].replace(/_/g, '-');
        const site = Math.max(
            ...(includes.get(name) ?? []).filter((index) => index < scope)
        );
        if (!Number.isFinite(site)) return null;
        // Each place with the definition it sits in, as that runs there.
        const places = definitionsAt(name, site).defs.flatMap((mixin) =>
            [...lexed.text.slice(mixin.start, mixin.end).matchAll(CONTENT)]
                .map((match) => mixin.start + match.index)
                .filter((index) => !inString(index))
                .filter((index) => placeOf(blocks, index).scope === mixin.start)
                .map((index) => ({ index, check: { name, site, def: mixin } }))
        );
        return places.length ? { places, site } : null;
    };
    // Cascade layers in declared order within their parent layer: as
    // `@layer a, b;` names them, or as a `@layer name { … }` block first
    // appears; an unnamed block is a layer of its own (`@<start>`).
    const layerIndex = new Map();
    const layerCount = new Map();
    const indexIn = (parent, name) => {
        const key = `${parent}/${name}`;
        if (!layerIndex.has(key)) {
            layerIndex.set(key, layerCount.get(parent) ?? 0);
            layerCount.set(parent, (layerCount.get(parent) ?? 0) + 1);
        }
        return layerIndex.get(key);
    };
    const layerNameOf = (block) =>
        block.prelude.replace(/^@layer\s*/i, '').trim() || `@${block.start}`;
    const parentLayer = (index) =>
        blocks
            .filter((b) => b.start < index && index < b.end)
            .filter((b) => /^@layer\b/i.test(b.prelude))
            .sort((a, b) => a.start - b.start)
            .flatMap((b) => layerNameOf(b).split('.'));
    const declare = (parent, name) => {
        const path = [...parent];
        for (const part of name.split('.')) {
            indexIn(path.join('/'), part);
            path.push(part);
        }
    };
    for (const match of lexed.text.matchAll(/@layer\b\s*([^{;]*)([{;])/gi)) {
        if (inString(match.index)) continue;
        const parent = parentLayer(match.index);
        if (match[2] === ';') {
            for (const name of match[1].split(',').map((n) => n.trim())) {
                if (name) declare(parent, name);
            }
        } else {
            const brace = match.index + match[0].length - 1;
            declare(parent, match[1].trim() || `@${brace}`);
        }
    }
    // A layer path to compare level by level, however deep: each level's
    // place among its siblings, then an end that ranks a layer's own
    // declarations above its sublayers' (and unlayered ones above every
    // layer).
    const layerPlace = (path) => [
        ...path.map((name, level) =>
            indexIn(path.slice(0, level).join('/'), name)
        ),
        Infinity,
    ];
    // A rule as compiled: its selector (`.p { &:hover {} }` is `.p:hover`,
    // `.w { .p .c {} }` is `.w .p .c`) and the context it applies in (its
    // at-rule wrappers and `@if`/`@each`); `null` for one without a style
    // rule. One the scan cannot know (`.#{$n}`) stays unique to its block.
    const UNCONDITIONAL = ' | ';
    const compiled = (rule) => {
        const split = rule.lastIndexOf(' | ');
        const chain = rule.slice(0, split);
        let selector = '';
        let layer = [];
        const wrappers = [];
        for (const part of chain.split(' < ').reverse()) {
            // A cascade layer always applies; it only ranks (see `rankOf`).
            if (/^@layer\b/i.test(part)) {
                layer = [
                    ...layer,
                    ...part
                        .replace(/^@layer\s*/i, '')
                        .trim()
                        .split('.'),
                ];
            } else if (part.startsWith('@')) wrappers.push(conditionKey(part));
            else if (part.includes('&'))
                selector = part.replaceAll('&', selector);
            else selector = selector ? `${selector} ${part}` : part;
        }
        if (!selector) return null;
        const context = `${wrappers.join(' ; ')} | ${rule.slice(split + 3)}`;
        return { selector: canonicalSelector(selector), context, layer };
    };
    // This file's `@extend`s, by the selector they extend: that rule's
    // declarations apply to the extending rule too, where they are written.
    const extenders = new Map();
    for (const match of lexed.text.matchAll(EXTEND)) {
        if (inString(match.index)) continue;
        const { scope } = placeOf(blocks, match.index);
        const context = compiled(rulesOf(scope)[0] ?? '')?.context;
        for (const target of selectorsOf(match[1]).map(canonicalSelector)) {
            if (!extenders.has(target)) extenders.set(target, []);
            extenders.get(target).push({ index: match.index, scope, context });
        }
    }
    // Who extends a rule on one compound: from anywhere, or (as Sass allows)
    // from inside the same `@media`.
    const extendersOf = (scope) =>
        rulesOf(scope).flatMap((rule) => {
            const form = compiled(rule);
            if (!form) return [];
            return (extenders.get(form.selector) ?? []).filter(
                ({ context }) =>
                    context === UNCONDITIONAL || context === form.context
            );
        });
    // Where a declaration in `scope` at `at` applies: its own rules, and
    // through each `@include` of a mixin (one included in another mixin
    // goes on to that one's includes) or `@extend` of a rule, theirs.
    // A cycle stops on its own path, so each `@include` of a mixin, two in
    // one rule included, is a landing of its own. A landing's `key` is its
    // place at each level, outermost first (see `keyOrder`): in the rule,
    // then in each mixin included and at each `@content` it goes through.
    // Each `@keyframes` name and the block defining it last (a later one
    // replaces it), and where a rule's last `animation`/`animation-name`
    // runs it (`hold`: it keeps a frame, by `forwards`, `both` or
    // `infinite`). A keyframe's declarations apply to that rule's elements
    // while it runs, over the rule's own; one that does not hold applies
    // only while it runs, so `transient: false` reads the rule after it.
    const definedLast = new Map();
    for (const block of blocks) {
        const named = KEYFRAMES.exec(block.prelude);
        if (named) definedLast.set(unquoted(named[1]), block.start);
    }
    const runs = new Map([...definedLast.keys()].map((name) => [name, []]));
    const lastRun = new Map();
    for (const match of lexed.text.matchAll(ANIMATION)) {
        if (inString(match.index) || inConditionPrelude(lexed, match.index)) {
            continue;
        }
        if (!startsDeclaration(lexed.text, match.index)) continue;
        const start = match.index + match[0].length;
        const { value, selector } = declarationText(lexed, start);
        const { scope } = placeOf(blocks, match.index);
        if (selector || scope === null || framesOf(scope)) continue;
        const longhand = /-name\s*:$/i.test(match[0]);
        lastRun.set(scope, { index: match.index, value, longhand });
    }
    for (const [scope, { index, value, longhand }] of lastRun) {
        const block = blocks.find((b) => b.start === scope);
        const own = lexed.text.slice(block.start, block.end);
        const hold = HOLDS.test(value) || HELD.test(own);
        for (const name of animationNames(value, longhand)) {
            const lists = name === null ? [...runs.values()] : [runs.get(name)];
            for (const list of lists) list?.push({ index, hold });
        }
    }
    // The `@keyframes` a block (one of its steps) sits in, if any.
    function framesOf(scope) {
        const frame = blocks
            .filter((b) => b.start <= scope && scope < b.end)
            .find((b) => KEYFRAMES.test(b.prelude));
        if (!frame) return null;
        const name = unquoted(KEYFRAMES.exec(frame.prelude)[1]);
        return { name, live: definedLast.get(name) === frame.start };
    }
    const framesText = (start) => {
        const block = blocks.find((b) => b.start === start);
        return block ? lexed.text.slice(block.start, block.end) : '';
    };
    // The rules running a keyframe, in the reading `transient` asks for.
    const runsOf = (frames) =>
        frames.live
            ? (runs.get(frames.name) ?? []).filter(
                  (run) => transient || run.hold
              )
            : [];
    const landingsOf = (scope, at, path = [], inner = [], checks = []) => {
        if (path.includes(scope)) return [];
        const next = [...path, scope];
        const key = [at, ...inner];
        // Outside any mixin body it runs at `at`, where each definition it
        // went through must be the one that runs; a module mixin runs for
        // another module once the module has run (`external`).
        if (!deferredBy(null, at) && !ranAt(checks, at)) return [];
        const own = {
            ...{ at, scope, rules: rulesOf(scope), key },
            ...(memberOf(scope) === null
                ? {}
                : { external: ranAt(checks, Infinity) }),
        };
        // A keyframe's declarations meet each other in its step, and run
        // from elsewhere too (another file, unseen here).
        const frames = scope === null ? null : framesOf(scope);
        if (frames) {
            return [
                own,
                ...runsOf(frames).flatMap(({ index: site }) =>
                    landingsOf(
                        placeOf(blocks, site).scope,
                        site,
                        next,
                        key,
                        checks
                    ).map((landing) => ({ ...landing, animated: true }))
                ),
            ];
        }
        const content = contentOf(scope);
        if (content) {
            const { places, site } = content;
            return places.flatMap(({ index: place, check }) =>
                landingsOf(
                    placeOf(blocks, site).scope,
                    site,
                    next,
                    [place, ...key],
                    [...checks, check]
                )
            );
        }
        const block = mixins.find((b) => b.start === scope);
        return [
            own,
            ...sitesOf(scope).flatMap((site) =>
                landingsOf(placeOf(blocks, site).scope, site, next, key, [
                    ...checks,
                    { name: block.name, site, def: block },
                ])
            ),
            ...extendersOf(scope).flatMap((extender) =>
                landingsOf(extender.scope, at, next, inner, checks)
            ),
        ];
    };

    // Where a declaration at `key` in another module's mixin lands through
    // the `@include` at `site`: as one written there, its key that place's
    // followed by `key`.
    const landingsAt = (site, key) => {
        // A bare name lands another module's only where none of this file's
        // runs there.
        const bare = /^@include\s+([\w-]+)(?![\w.-])/i.exec(
            lexed.text.slice(site, site + 256)
        );
        const checks = bare
            ? [{ name: bare[1].replace(/_/g, '-'), site, def: null }]
            : [];
        return landingsOf(placeOf(blocks, site).scope, site, [], key, checks);
    };
    // Each declaration, where it applies, in source order.
    const applied = [];
    for (const match of lexed.text.matchAll(FONT_FAMILY)) {
        if (inString(match.index) || inConditionPrelude(lexed, match.index)) {
            continue;
        }
        if (!startsDeclaration(lexed.text, match.index)) continue;
        const start = match.index + match[0].length;
        const { value, selector } = declarationText(lexed, start);
        const place = placeOf(blocks, match.index);
        if (selector || place.scope === null) continue;
        // A nested `font: { family: … }` sets its rule's family.
        const namespace = fontNamespaceRule(blocks, place);
        const property = match[1].toLowerCase();
        if (property === 'family' && namespace === undefined) continue;
        // A shorthand that fails to parse is dropped, family and all.
        if (property === 'font' && !parsesAsFont(value)) continue;
        const important = IMPORTANT.test(value);
        const parts = familyParts(value);
        const shorthand = property === 'font';
        const entry = {
            important,
            inherit: /^\s*(?:inherit|unset|revert|revert-layer)\b/i.test(value),
            revertLayer: /^\s*revert-layer\b/i.test(value),
            mono: rendersMono(parts.outside, { shorthand, defer: true }),
            shorthand,
            refs: refsIn(parts, match.index, place),
            // The whole family and where it sits, to resolve it later.
            text: value,
            at: { index: match.index, ...place },
        };
        for (const landing of landingsOf(
            namespace ?? place.scope,
            match.index
        )) {
            applied.push({
                ...landing,
                entry: landing.animated ? { ...entry, animated: true } : entry,
            });
        }
    }
    for (const match of lexed.text.matchAll(ALL_RESET)) {
        if (inString(match.index) || inConditionPrelude(lexed, match.index)) {
            continue;
        }
        if (!startsDeclaration(lexed.text, match.index)) continue;
        const place = placeOf(blocks, match.index);
        if (place.scope === null) continue;
        const entry = {
            important: Boolean(match[2]),
            inherit: match[1].toLowerCase() !== 'initial',
            revertLayer: match[1].toLowerCase() === 'revert-layer',
            ...{ mono: false, shorthand: false, refs: [], text: match[1] },
            at: { index: match.index, ...place },
        };
        for (const landing of landingsOf(place.scope, match.index)) {
            applied.push({
                ...landing,
                entry: landing.animated ? { ...entry, animated: true } : entry,
            });
        }
    }
    for (const [site, families] of included) {
        for (const { key, entry } of families) {
            for (const landing of landingsAt(site, key)) {
                applied.push({
                    ...landing,
                    entry: landing.animated
                        ? { ...entry, animated: true }
                        : entry,
                });
            }
        }
    }
    // What each module mixin sets at its top level, for the modules that
    // include it: its own declarations and those landing in it.
    const exported = new Map();
    for (const { scope, key, entry, external } of applied) {
        const name = memberOf(scope);
        if (name === null || external === false) continue;
        if (!exported.has(name)) exported.set(name, []);
        exported.get(name).push({ key, entry });
    }
    // Keyed by rule, so a later block with one of its selectors wins.
    applied.sort((a, b) => keyOrder(a.key, b.key));
    // Where each rule's family was set, for the cascade between rules.
    const orderOf = new Map();
    for (const { rules, entry, at } of applied) {
        for (const rule of rules) {
            if (levelOf(family.get(rule)) > levelOf(entry)) continue;
            family.set(rule, entry);
            orderOf.set(rule, at);
        }
    }
    // Every rule's family with its compiled selector and context.
    const compiledRules = [];
    for (const [rule, entry] of family) {
        const form = compiled(rule);
        if (form) {
            const alternatives = complexOf(form.selector);
            compiledRules.push({ rule, entry, ...form, alternatives });
        }
    }
    const chosen = (found, complete) =>
        found.find((entry) => entry.mono) ??
        found.find((entry) => entry.refs.length > 0) ??
        (complete ? found[0] : undefined) ??
        null;
    // Every rule as the compounds of each selector it reads as, each with
    // the ways its simple selectors read: an element of `.x:hover` is an
    // `.x`, and one of `.p .x:hover` (or `.w .p .x:hover`) a `.p .x`, so a
    // family they set reaches it, in the same context or where the base
    // always applies.
    const bases = compiledRules
        .map((base) => ({
            ...base,
            chains: base.alternatives.flatMap((alternative) => {
                const chain = compoundsOf(alternative).map((part) => {
                    const simples = simplesOf(part.compound);
                    return (
                        simples && { ...part, ways: alternativesOf(simples) }
                    );
                });
                return chain.every(Boolean) ? [chain] : [];
            }),
        }))
        .filter(({ chains }) => chains.length);
    // Whether a base reaches every element of a reader's `selector` read
    // `way` at its target: its compounds, last to last, each contained in
    // one of the reader's (`*` in any), in order and across what its
    // combinators allow (a descendant across `>` or ` ` chains, `~` across
    // `+` or `~` ones, `>` and `+` only their own); what the reader names
    // besides only narrows it.
    const covers = (base, selector, way) => {
        const reader = compoundsOf(selector);
        const within = (part, k) => {
            const simples = (
                k === reader.length - 1 ? way : simplesOf(reader[k].compound)
            )?.map(matchKey);
            return part.ways.some((ways) =>
                ways.every((s) => s === '*' || simples?.includes(matchKey(s)))
            );
        };
        // With `chain[i]` at the reader's `k`, whether the compounds before
        // it fit further left, trying each place a span allows in turn (a
        // nearer `.b` may leave no room for `.a > .b`'s `>`).
        const fits = (chain, i, k) => {
            if (i === 0) return true;
            const combinator = chain[i].combinator;
            const across = ACROSS[combinator] ?? [combinator];
            for (let j = k - 1; j >= 0; j -= 1) {
                if (!across.includes(reader[j + 1].combinator)) return false;
                if (within(chain[i - 1], j) && fits(chain, i - 1, j)) {
                    return true;
                }
                if (across.length === 1) return false;
            }
            return false;
        };
        const last = reader.length - 1;
        return base.chains.some(
            (chain) =>
                within(chain.at(-1), last) &&
                fits(chain, chain.length - 1, last)
        );
    };
    // Whether a rule reaches every element of `selector` (see `covers`),
    // in any way its target reads.
    const baseOf = new Map(bases.map((base) => [base.rule, base]));
    const reaches = (form, selector) => {
        const base = baseOf.get(form.rule);
        const target = compoundsOf(selector).at(-1)?.compound;
        const simples = base && target ? simplesOf(target) : null;
        return Boolean(
            simples &&
            alternativesOf(simples).some((way) => covers(base, selector, way))
        );
    };
    // A declaration's place in the cascade: `!important`, then its layer
    // (see `layerPlace`; `!important` turns the order round), then
    // specificity, then source order.
    const rankOf = (entry, { selector, layer = [] }, order = 0) => ({
        important: levelOf(entry),
        layer: layerPlace(layer),
        specificity: specificityOf(selector),
        order,
    });
    // The cascade's winner among ranked candidates (`{ entry, rank }`). A
    // `revert-layer` one rolls the cascade back past its layer: the winner
    // among the others, else it inherits.
    const winnerOf = (candidates) => {
        const best = candidates.reduce(
            (a, b) => (a && rankAbove(a.rank, b.rank) ? a : b),
            null
        );
        if (!best?.entry.revertLayer) return best;
        const others = candidates.filter(
            ({ rank }) =>
                rank.important !== best.rank.important ||
                ordered(rank.layer, best.rank.layer) !== 0
        );
        return winnerOf(others) ?? best;
    };
    // The family the cascade gives an element of `selectors` (the rules
    // on one element, as `html` and `:root` are), in `context` or always:
    // `null` when none sets one or the winner inherits.
    const winnerAt = (selectors, context) => {
        const ranked = compiledRules
            .filter(
                (form) =>
                    form.alternatives.some((alternative) =>
                        selectors.includes(alternative)
                    ) || selectors.some((selector) => reaches(form, selector))
            )
            .filter((form) => encloses(form.context, context))
            .map((form) => ({
                entry: form.entry,
                rank: rankOf(form.entry, form, orderOf.get(form.rule)),
            }));
        const best = winnerOf(ranked);
        return best && !best.entry.inherit ? best.entry : null;
    };
    // The family an at-rule block (`@media` inside a rule) sets itself.
    const ownFamily = (block) => {
        const rules = rulesOf(block.start);
        const set = rules
            .map((rule) => family.get(rule))
            .filter((entry) => entry && !entry.inherit);
        const named =
            set.find((entry) => entry.mono) ??
            set.find((entry) => entry.refs.length > 0);
        if (named) return named;
        return set.length && set.length === rules.length ? set[0] : null;
    };
    // The family on an element of each of a rule's selectors: the cascade
    // winner (`!important`, then specificity, then source order) among its
    // own rule, the bases it contains and `*`. One whose winner inherits
    // (or with none) takes the family its element inherits.
    const elementFamily = (block) => {
        // Each way a rule's target reads (`:is(.x, .y)` is `.x` or `.y`,
        // `:where(.p .c)` is `.p .c`).
        const targets = rulesOf(block.start).flatMap((rule) => {
            const form = compiled(rule);
            if (!form) return [{ rule, form }];
            return complexOf(form.selector).flatMap((selector) => {
                const target = compoundsOf(selector).at(-1)?.compound;
                const simples = simplesOf(target ?? '') ?? [];
                return alternativesOf(simples).map((way) => ({
                    ...{ rule, form, selector, way },
                }));
            });
        });
        const ranked = (other) => ({
            entry: other.entry,
            rank: rankOf(other.entry, other, orderOf.get(other.rule)),
        });
        const winners = targets.map(({ rule, form, selector, way }) => {
            if (!form) return family.get(rule) ?? null;
            const applies = (other) => encloses(other.context, form.context);
            const candidates = [
                ...bases
                    .filter(applies)
                    .filter((base) => covers(base, selector, way))
                    .map(ranked),
                // A rule on the same elements written another way
                // (`:where(.p .c)` for `.p .c`).
                ...compiledRules
                    .filter(applies)
                    .filter((other) => other.alternatives.includes(selector))
                    .map(ranked),
            ];
            const own = family.get(rule);
            if (own && !candidates.some(({ entry }) => entry === own)) {
                candidates.push({
                    entry: own,
                    rank: rankOf(own, form, orderOf.get(rule)),
                });
            }
            const best = winnerOf(candidates);
            return best?.entry ?? null;
        });
        const set = winners.filter((entry) => entry && !entry.inherit);
        const named =
            set.find((entry) => entry.mono) ??
            set.find((entry) => entry.refs.length > 0);
        if (named) return named;
        return set.length && set.length === targets.length ? set[0] : null;
    };
    // The nearest ancestor its compiled selector names (`.w .p .c` has
    // `.w .p`, then `.w`) that sets a family, in its context or always: by
    // that whole selector, or its last compound alone (`.p` is an element
    // of `.w .p` too).
    const fromAncestors = (block) => {
        const found = rulesOf(block.start).flatMap((rule) => {
            const form = compiled(rule);
            const nearest = (selector) => {
                for (const ancestor of ancestorsOf(selector)) {
                    const own = compoundsOf(ancestor).at(-1).compound;
                    const entry = winnerAt([ancestor, own], form.context);
                    if (entry) return [entry];
                }
                return [];
            };
            return form ? complexOf(form.selector).flatMap(nearest) : [];
        });
        return chosen(found, true) ?? NONE;
    };
    const lookup = (index) => {
        const around = blocks
            .filter((b) => b.start < index && index < b.end)
            .filter((b) => b.kind !== 'flow')
            .reverse();
        // A rule that puts its parent after a prefix (`.x &`) names more
        // ancestors than its parents do: they are read from its compiled
        // selector, once its parents (the same element) set no family, at
        // the first parent without `&` (a top-level rule has none) or past
        // the walk.
        let deeper = null;
        for (const block of around) {
            if (/^@font-face\b/i.test(block.prelude)) return NONE;
            // A selector list meets the cap when one of its selectors
            // renders Mono; one without a family of its own inherits it.
            const selector = styleSelector(block);
            const own =
                selector !== null ? elementFamily(block) : ownFamily(block);
            if (own) return own;
            // A rule on another element (not `&…`) inherits from the
            // nearest ancestor its selector names.
            if (selector?.includes('&')) {
                if (!selector.startsWith('&')) deeper ??= block;
            } else if (selector !== null) {
                const ancestor = fromAncestors(deeper ?? block);
                if (ancestor !== NONE) return ancestor;
                deeper = null;
            }
            // An `@at-root` that leaves out a block around it (see
            // `atRootExcludes`) is written out away from it: what is
            // around it counts only as its compiled selector and context
            // name it. One that leaves none out is the same element.
            const excludes = atRootExcludes(block.prelude);
            if (excludes) {
                const leaves = around.some(
                    (b) =>
                        b.start < block.start && excludes(blockKind(b.prelude))
                );
                if (leaves) break;
                if (selector === null) continue;
            }
            if (!inherits(selector ?? block.prelude)) return NONE;
        }
        // Past such an `@at-root`, a `.x &` reads its ancestors here.
        if (deeper) {
            const ancestor = fromAncestors(deeper);
            if (ancestor !== NONE) return ancestor;
        }
        // Else from the document's root: a plain `:host`, `body`, then the
        // root element (`html` and `:root`), in the reader's context (its
        // `@media`) or always.
        const reader = around.find((b) => styleSelector(b) !== null);
        const context = reader
            ? (compiled(rulesOf(reader.start)[0] ?? '')?.context ??
              UNCONDITIONAL)
            : UNCONDITIONAL;
        for (const element of [[':host'], ['body'], ['html', ':root']]) {
            const entry = winnerAt(element, context);
            if (entry) return entry;
        }
        return NONE;
    };
    // A weight in a mixin's body, or in a rule others extend, meets the
    // family where it lands: each rule that includes or extends it (whose
    // own later family wins), of those `keep` accepts (where the weight is
    // in effect). A mixin's body, or a placeholder (`%x`), styles nothing
    // where it is written; one another module includes meets the family
    // there instead.
    const familyAt = (index, keep, seen = new Set(), checks = []) => {
        const place = placeOf(blocks, index);
        const scope = fontNamespaceRule(blocks, place) ?? place.scope;
        if (seen.has(scope)) return [];
        seen.add(scope);
        // Read where it runs, if the definitions on the way run there (see
        // `landingsOf`); a mixin body included nowhere, once the module ran.
        const runs = ranAt(checks, deferredBy(null, index) ? Infinity : index);
        // A content block's declaration meets the family at its `@include`,
        // a keyframe's where a rule runs it.
        const content = contentOf(scope);
        if (content) return familyAt(content.site, keep, seen, checks);
        const frames = scope === null ? null : framesOf(scope);
        if (frames) {
            if (!frames.live) return [];
            return [
                ...(keep(scope) && runs ? [lookup(index)] : []),
                ...runsOf(frames).flatMap(({ index: site }) =>
                    familyAt(site, keep, seen, checks)
                ),
            ];
        }
        const block = blocks.find((b) => b.start === scope);
        const includes = sitesOf(scope);
        const extended = extendersOf(scope).map((extender) => extender.index);
        // Where another module includes it, it meets families unseen here.
        const outside =
            elsewhere.has(memberOf(scope)) && ranAt(checks, Infinity);
        const silent =
            includes.length > 0 ||
            elsewhere.has(memberOf(scope)) ||
            (extended.length > 0 && /^%/.test(block?.prelude ?? ''));
        return [
            ...(silent || !keep(scope) || !runs ? [] : [lookup(index)]),
            ...(outside ? [OUTSIDE] : []),
            ...includes.flatMap((site) =>
                familyAt(site, keep, seen, [
                    ...checks,
                    { name: block.name, site, def: block },
                ])
            ),
            ...extended.flatMap((site) => familyAt(site, keep, seen, checks)),
        ];
    };

    const monoAt = (index, keep = () => true) => {
        const found = familyAt(index, keep).filter(
            (entry) => entry !== NONE && entry !== OUTSIDE
        );
        return (
            found.find((entry) => entry.mono) ??
            found.find((entry) => entry.refs.length > 0) ??
            found[0] ??
            NONE
        );
    };
    // The families an `@include` at `site` meets, wherever it lands:
    // whether one renders JetBrains Mono (`mono`, also when the mixin it
    // sits in lands in another module, unseen here), and those named
    // through variables (`families`), resolved later.
    monoAt.callAt = (site) => {
        const found = familyAt(site, () => true);
        return {
            mono: found.some((entry) => entry.mono || entry === OUTSIDE),
            families: found.filter(
                (entry) => !entry.mono && entry.refs.length > 0
            ),
        };
    };
    // Where a declaration at `index` lands (`{ at, scope, rules }`, see
    // `landingsOf`), for the weights in effect.
    // Whether a rule runs a keyframe that sets a font only for a while,
    // so the rule after it needs reading too (`transient: false`).
    monoAt.transient = [...runs].some(
        ([name, list]) =>
            list.some((run) => !run.hold) &&
            FONT_IN_FRAMES.test(framesText(definedLast.get(name)))
    );
    monoAt.landings = (index) => {
        const place = placeOf(blocks, index);
        const scope = fontNamespaceRule(blocks, place) ?? place.scope;
        return scope === null ? [] : landingsOf(scope, index);
    };
    monoAt.landingsAt = landingsAt;
    monoAt.memberOf = memberOf;
    monoAt.definitionsAt = definitionsAt;
    // Each module mixin's top-level families, by name (`{ key, entry }`).
    monoAt.exported = exported;
    return monoAt;
}
