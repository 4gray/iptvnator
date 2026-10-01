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
 * One family entry, decided outright: `mono` (JetBrains Mono), `stop` (a
 * family that renders every glyph), `open` (another face), or `null` for a
 * variable (`var(…)`, `$x`, `#{…}`) whose value decides.
 */
export function entryVerdict(entry) {
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
export function rendersMono(value, { shorthand = false, defer = false } = {}) {
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

/** One simple selector: a type or `*`, class, id, attribute or pseudo. */
const SIMPLE =
    /\*|[a-z][\w-]*|\.(?:\\.|[\w-])+|#(?:\\.|[\w-])+|\[[^\]]*\]|::?[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?/iy;

/**
 * A compound's simple selectors (`a.x:hover` is `a`, `.x`, `:hover`), or
 * `null` for one this cannot split: a Sass `&` or interpolation, or more
 * than one compound.
 */
function simplesOf(compound) {
    const simples = [];
    SIMPLE.lastIndex = 0;
    while (SIMPLE.lastIndex < compound.length) {
        const match = SIMPLE.exec(compound);
        if (!match) return null;
        simples.push(match[0]);
    }
    return simples;
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

/** Whether cascade rank `a` beats `b` (a later equal rank wins). */
function rankAbove(a, b) {
    if (a.important !== b.important) return a.important;
    const layer = ordered(a.layer, b.layer);
    if (layer) return a.important ? layer < 0 : layer > 0;
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

/**
 * The family each rule sets (every block with one of its selector chains,
 * see `rulesOf`), the last declaration in source order winning unless an
 * earlier one is `!important`: whether it names JetBrains Mono outright (`mono`),
 * the variables it reads (`refs`, from `familyParts`, resolved later across
 * the workspace) or that it inherits (`inherit`/`unset`). Returns
 * `monoAt(index)`: the family in effect for a declaration there, from the
 * innermost rule that sets one and that the declaration's rule inherits
 * from. `@font-face` describes a face, so nothing in it is capped.
 */
export function familiesOf(
    lexed,
    blocks,
    { inString, placeOf, refsIn, rulesOf }
) {
    const family = new Map();
    // This file's `@include` sites, by mixin: a declaration in a mixin's
    // body lands in the rule that includes it, at the `@include`.
    const includes = new Map();
    for (const match of lexed.text.matchAll(INCLUDE)) {
        if (inString(match.index)) continue;
        const name = match[1].replace(/_/g, '-');
        if (!includes.has(name)) includes.set(name, []);
        includes.get(name).push(match.index);
    }
    const sitesOf = (scope) => {
        const block = blocks.find((b) => b.start === scope);
        // Only a mixin is included (a function's body sets nothing).
        return block?.kind === 'callable'
            ? (includes.get(block.name) ?? [])
            : [];
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
            } else if (part.startsWith('@')) wrappers.push(part);
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
    // one rule included, is a landing of its own.
    const landingsOf = (scope, at, path = []) => {
        if (path.includes(scope)) return [];
        const next = [...path, scope];
        return [
            { at, scope, rules: rulesOf(scope) },
            ...sitesOf(scope).flatMap((site) =>
                landingsOf(placeOf(blocks, site).scope, site, next)
            ),
            ...extendersOf(scope).flatMap((extender) =>
                landingsOf(extender.scope, at, next)
            ),
        ];
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
            applied.push({ ...landing, entry });
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
            ...{ mono: false, shorthand: false, refs: [], text: match[1] },
            at: { index: match.index, ...place },
        };
        for (const landing of landingsOf(place.scope, match.index)) {
            applied.push({ ...landing, entry });
        }
    }
    // Keyed by rule, so a later block with one of its selectors wins.
    applied.sort((a, b) => a.at - b.at);
    // Where each rule's family was set, for the cascade between rules.
    const orderOf = new Map();
    for (const { rules, entry, at } of applied) {
        for (const rule of rules) {
            if (family.get(rule)?.important && !entry.important) continue;
            family.set(rule, entry);
            orderOf.set(rule, at);
        }
    }
    // Every rule's family by its compiled selector and context.
    const byCompiled = new Map();
    const compiledRules = [];
    for (const [rule, entry] of family) {
        const form = compiled(rule);
        if (!form) continue;
        compiledRules.push({ rule, entry, ...form });
        if (entry.inherit) continue;
        const key = `${form.selector} # ${form.context}`;
        if (!byCompiled.has(key)) byCompiled.set(key, []);
        byCompiled.get(key).push(entry);
    }
    // The families a compiled selector has in a context: there, or in a
    // rule that always applies.
    const familiesAt = (selector, context) => [
        ...(byCompiled.get(`${selector} # ${context}`) ?? []),
        ...(context === UNCONDITIONAL
            ? []
            : (byCompiled.get(`${selector} # ${UNCONDITIONAL}`) ?? [])),
    ];
    const chosen = (found, complete) =>
        found.find((entry) => entry.mono) ??
        found.find((entry) => entry.refs.length > 0) ??
        (complete ? found[0] : undefined) ??
        null;
    // The rules on a single compound (`.x`, `a.b`, `:where(.x)`), with the
    // ways their simple selectors read: an element of `.x:hover` is an `.x`,
    // so a family `.x` sets reaches it, in the same context or where the
    // base always applies.
    const bases = compiledRules
        .map((base) => {
            const simples = simplesOf(base.selector);
            return { ...base, ways: simples ? alternativesOf(simples) : [] };
        })
        .filter(({ ways }) => ways.length);
    // A declaration's place in the cascade: `!important`, then its layer
    // (see `layerPlace`; `!important` turns the order round), then
    // specificity, then source order.
    const rankOf = (entry, { selector, layer = [] }, order = 0) => ({
        important: Boolean(entry.important),
        layer: layerPlace(layer),
        specificity: specificityOf(selector),
        order,
    });
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
        // Each way a rule's target reads (`:is(.x, .y)` is `.x` or `.y`).
        const targets = rulesOf(block.start).flatMap((rule) => {
            const form = compiled(rule);
            if (!form) return [{ rule, form }];
            const target = compoundsOf(form.selector).at(-1)?.compound;
            const simples = simplesOf(target ?? '') ?? [];
            return alternativesOf(simples).map((way) => ({ rule, form, way }));
        });
        const winners = targets.map(({ rule, form, way: simples }) => {
            if (!form) return family.get(rule) ?? null;
            const candidates = bases
                .filter(
                    (base) =>
                        base.context === form.context ||
                        base.context === UNCONDITIONAL
                )
                // `*` matches every element.
                .filter((base) =>
                    base.ways.some((way) =>
                        way.every((s) => s === '*' || simples.includes(s))
                    )
                )
                .map((base) => ({
                    entry: base.entry,
                    rank: rankOf(base.entry, base, orderOf.get(base.rule)),
                }));
            const own = family.get(rule);
            if (own && !candidates.some(({ entry }) => entry === own)) {
                candidates.push({
                    entry: own,
                    rank: rankOf(own, form, orderOf.get(rule)),
                });
            }
            const best = candidates.reduce(
                (a, b) => (a && rankAbove(a.rank, b.rank) ? a : b),
                null
            );
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
            for (const ancestor of form ? ancestorsOf(form.selector) : []) {
                const own = compoundsOf(ancestor).at(-1).compound;
                const entries = [
                    ...familiesAt(ancestor, form.context),
                    ...(own === ancestor ? [] : familiesAt(own, form.context)),
                ];
                if (entries.length) return entries;
            }
            return [];
        });
        return chosen(found, true) ?? NONE;
    };
    const lookup = (index) => {
        const around = blocks
            .filter((b) => b.start < index && index < b.end)
            .filter((b) => b.kind !== 'flow')
            .reverse();
        for (const block of around) {
            if (/^@font-face\b/i.test(block.prelude)) return NONE;
            // A selector list meets the cap when one of its selectors
            // renders Mono; one without a family of its own inherits it.
            const style = !block.prelude.startsWith('@');
            const own = style ? elementFamily(block) : ownFamily(block);
            if (own) return own;
            // A rule on another element (not `&…`) inherits from the
            // nearest ancestor its selector names.
            if (style && !block.prelude.includes('&')) {
                const ancestor = fromAncestors(block);
                if (ancestor !== NONE) return ancestor;
            }
            if (!inherits(block.prelude)) return NONE;
        }
        // Else from the document's root: a plain `:host`, `body`, `html` or
        // `:root`, in the reader's context (its `@media`) or always.
        const reader = around.find((b) => !b.prelude.startsWith('@'));
        const context = reader
            ? (compiled(rulesOf(reader.start)[0] ?? '')?.context ??
              UNCONDITIONAL)
            : UNCONDITIONAL;
        for (const root of [':host', 'body', 'html', ':root']) {
            const found = familiesAt(root, context);
            if (found.length) return chosen(found, true);
        }
        return NONE;
    };
    // A weight in a mixin's body, or in a rule others extend, meets the
    // family where it lands: each rule that includes or extends it (whose
    // own later family wins), of those `keep` accepts (where the weight is
    // in effect). A mixin's body, or a placeholder (`%x`), styles nothing
    // where it is written.
    const familyAt = (index, keep, seen = new Set()) => {
        const place = placeOf(blocks, index);
        const scope = fontNamespaceRule(blocks, place) ?? place.scope;
        if (seen.has(scope)) return [];
        seen.add(scope);
        const block = blocks.find((b) => b.start === scope);
        const includes = sitesOf(scope);
        const extended = extendersOf(scope).map((extender) => extender.index);
        const silent =
            includes.length > 0 ||
            (extended.length > 0 && /^%/.test(block?.prelude ?? ''));
        return [
            ...(silent || !keep(scope) ? [] : [lookup(index)]),
            ...[...includes, ...extended].flatMap((site) =>
                familyAt(site, keep, seen)
            ),
        ];
    };
    const monoAt = (index, keep = () => true) => {
        const found = familyAt(index, keep).filter((entry) => entry !== NONE);
        return (
            found.find((entry) => entry.mono) ??
            found.find((entry) => entry.refs.length > 0) ??
            found[0] ??
            NONE
        );
    };
    // Where a declaration at `index` lands (`{ at, scope, rules }`, see
    // `landingsOf`), for the weights in effect.
    monoAt.landings = (index) => {
        const place = placeOf(blocks, index);
        const scope = fontNamespaceRule(blocks, place) ?? place.scope;
        return scope === null ? [] : landingsOf(scope, index);
    };
    return monoAt;
}
