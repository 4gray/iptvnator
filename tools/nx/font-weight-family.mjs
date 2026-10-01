/**
 * Which stylesheet rules render in JetBrains Mono, for the weight cap in
 * `check-font-weights.mjs`.
 */

/** JetBrains Mono is bundled at 400 and 500 only (see `styles.scss`). */
export const MONO_WEIGHT_CAP = 500;
export const MONO_FAMILY = /jetbrains\s+mono/i;

const FONT_FAMILY = /(?<![\w$-])(font-family|font)\s*:/gi;
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
        outside += ' ';
        i = end;
    }
    return { outside, vars };
}

/** A selector list split at its top-level commas (`:is(a, b)` stays whole). */
function selectorsOf(prelude) {
    const selectors = [];
    let depth = 0;
    let current = '';
    for (const char of prelude) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) {
            selectors.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    return [...selectors, current.trim()];
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
        if (inString(match.index)) continue;
        const start = match.index + match[0].length;
        const { value, selector } = declarationText(lexed, start);
        const place = placeOf(blocks, match.index);
        if (selector || place.scope === null) continue;
        const important = /!important\b/i.test(value);
        if (family.get(place.scope)?.important && !important) continue;
        const parts = familyParts(value);
        family.set(place.scope, {
            important,
            inherit: /^\s*(?:inherit|unset)\b/i.test(value),
            mono: MONO_FAMILY.test(parts.outside),
            refs: refsIn(parts, match.index, place),
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
