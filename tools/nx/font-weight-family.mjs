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
 * `selector` means a `{` came first.
 */
export function declarationText({ text, quoteAt }, start) {
    let end = start;
    while (end < text.length && (quoteAt[end] || !';{}'.includes(text[end]))) {
        end += 1;
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
    const text = value.replace(/!important\b/i, '').trim();
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
    if (/var\(|\$|#\{/i.test(entry)) return null;
    const family = familyName(entry);
    if (!family) return 'open';
    if (MONO_FAMILY.test(family.name)) return 'mono';
    if (BUNDLED.test(family.name)) return 'stop';
    if (!family.quoted && GENERIC.test(family.name)) return 'stop';
    return 'open';
}

/** A family list's entries, split at its top-level commas. */
export function familyEntries(list) {
    return selectorsOf(list.replace(/!important\b/i, ''));
}

/**
 * The family list of a `font` shorthand: what follows its size and
 * `/line-height`, or `null` when it has no size.
 */
export function shorthandFamilies(value) {
    const tokens = tokensOf(value.replace(/!important\b/i, ''));
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
        const open = /^var\(\s*(--[\w-]+)\s*(,)?/i.exec(value.slice(i));
        if (!open) {
            outside += value[i];
            i += 1;
            continue;
        }
        let end = i + open[0].length;
        for (let depth = 1; end < value.length && depth > 0; end += 1) {
            if (value[end] === '(') depth += 1;
            if (value[end] === ')') depth -= 1;
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
 * Whether a rule's custom properties reach every element: `:root`, `html`,
 * `body` or `*` (a component's `:host` reaches only its own view).
 */
export function reachesEverything(prelude, reader = null) {
    if (!prelude) return false;
    // `body` sits below `html`, so it cannot pass a property up to it.
    const rootReader = reader
        ? rootSelectors(reader).some((s) => /^(?::root|html)$/i.test(s))
        : false;
    return rootSelectors(prelude).some(
        (selector) =>
            /^(?::root|html|\*)$/i.test(selector) ||
            (/^body$/i.test(selector) && !rootReader)
    );
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
 * other elements; any other at-rule (a mixin body included elsewhere) is
 * set where it runs.
 */
function inherits(prelude) {
    if (prelude.startsWith('@')) return SAME_ELEMENT.test(prelude);
    return selectorsOf(prelude).some(
        (selector) => !/^&[\w-]/.test(selector) && !/^&?\s*[+~]/.test(selector)
    );
}

/**
 * The family each rule sets, the last declaration winning unless an earlier
 * one is `!important`: whether it names JetBrains Mono outright (`mono`),
 * the variables it reads (`refs`, from `familyParts`, resolved later across
 * the workspace) or that it inherits (`inherit`/`unset`). Returns
 * `monoAt(index)`: the family in effect for a declaration there, from the
 * innermost rule that sets one and that the declaration's rule inherits
 * from. `@font-face` describes a face, so nothing in it is capped.
 */
export function familiesOf(lexed, blocks, { inString, placeOf, refsIn }) {
    const family = new Map();
    for (const match of lexed.text.matchAll(FONT_FAMILY)) {
        if (inString(match.index) || inConditionPrelude(lexed, match.index)) {
            continue;
        }
        const start = match.index + match[0].length;
        const { value, selector } = declarationText(lexed, start);
        const place = placeOf(blocks, match.index);
        if (selector || place.scope === null) continue;
        // A nested `font: { family: … }` sets its rule's family.
        const namespace = fontNamespaceRule(blocks, place);
        const property = match[1].toLowerCase();
        if (property === 'family' && namespace === undefined) continue;
        const scope = namespace ?? place.scope;
        // A shorthand that fails to parse is dropped, family and all.
        if (property === 'font' && !parsesAsFont(value)) continue;
        const important = /!important\b/i.test(value);
        if (family.get(scope)?.important && !important) continue;
        const parts = familyParts(value);
        const shorthand = property === 'font';
        family.set(scope, {
            important,
            inherit: /^\s*(?:inherit|unset)\b/i.test(value),
            mono: rendersMono(parts.outside, { shorthand, defer: true }),
            shorthand,
            refs: refsIn(parts, match.index, place),
            // The whole family and where it sits, to resolve it later.
            text: value,
            at: { index: match.index, ...place },
        });
    }
    return (index) => {
        const around = blocks
            .filter((b) => b.start < index && index < b.end)
            .filter((b) => b.kind !== 'flow')
            .reverse();
        for (const block of around) {
            if (/^@font-face\b/i.test(block.prelude)) return NONE;
            const own = family.get(block.start);
            if (own && !own.inherit) return own;
            if (!inherits(block.prelude)) return NONE;
        }
        return NONE;
    };
}
