/**
 * Just enough lexing for `check-font-weights.mjs`: comments, the string that
 * encloses each position, and where a declaration's value ends.
 */

const QUOTES = new Set(["'", '"', '`']);
const VALUE_END = new Set([';', '{', '}', ']']);

/**
 * Plain CSS has block comments only; SCSS and TypeScript add `//`. An
 * unquoted `url(//cdn…)` or `https://` exists only in stylesheets: in
 * TypeScript a URL is always inside a string, so every `//` there is a
 * comment.
 */
function syntaxOf(file) {
    if (file.endsWith('.html')) return { html: true, quotes: ['"', "'"] };
    const typescript = file.endsWith('.ts');
    return {
        block: true,
        line: !file.endsWith('.css'),
        protocol: !typescript,
        quotes: typescript ? ['"', "'", '`'] : ['"', "'"],
    };
}

/**
 * Blanks comments, keeping every newline so line numbers hold, and records
 * the quote enclosing each position: a comment marker inside a string is
 * text. In a stylesheet, `//` right after `:` or `(` is a URL, not a
 * comment. HTML strings are attribute values, so they open only inside tags.
 */
export function lex(file, source) {
    const syntax = syntaxOf(file);
    const text = source.split('');
    const quoteAt = new Array(source.length).fill('');
    const blank = (from, to) => {
        for (let k = from; k < to; k += 1) if (text[k] !== '\n') text[k] = ' ';
        return to - 1;
    };
    const until = (marker, from) => {
        const at = source.indexOf(marker, from);
        return at === -1 ? source.length : at + marker.length;
    };
    let quote = '';
    let inTag = false;
    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (quote) {
            quoteAt[i] = quote;
            if (char === '\\' && i + 1 < source.length) {
                quoteAt[i + 1] = quote;
                i += 1;
            } else if (char === quote) {
                quote = '';
            } else if (char === '\n' && quote !== '`' && !syntax.html) {
                quote = '';
            }
        } else if (syntax.html && source.startsWith('<!--', i)) {
            i = blank(i, until('-->', i + 4));
        } else if (syntax.html) {
            if (char === '<') inTag = true;
            if (char === '>') inTag = false;
            if (inTag && syntax.quotes.includes(char)) quote = char;
        } else if (syntax.block && source.startsWith('/*', i)) {
            i = blank(i, until('*/', i + 2));
        } else if (
            syntax.line &&
            source.startsWith('//', i) &&
            !(syntax.protocol && /[:(]/.test(source[i - 1] ?? ''))
        ) {
            const lineEnd = source.indexOf('\n', i);
            i = blank(i, lineEnd === -1 ? source.length : lineEnd);
        } else if (syntax.quotes.includes(char)) {
            quote = char;
        }
    }
    return { text: text.join(''), quoteAt };
}

/**
 * A declaration's value, across line breaks, so a wrapped
 * `var(--x,\n    650)` keeps its fallback. It stays inside the string that
 * encloses the declaration (an inline style) and skips the CSS strings within
 * it, so `font: 650 12px 'DM Sans'` keeps its family. Sass `#{…}` and template
 * `${…}` interpolations are part of the value. It ends at `;`, a brace, or,
 * outside parentheses, at a comma or the `)` that closes a Sass map or
 * argument list. A `{` first means the match was a selector such as
 * `.x-weight:hover`.
 */
export function valueAfter({ text, quoteAt }, start) {
    const enclosing = quoteAt[start] ?? '';
    let depth = 0;
    let interpolation = 0;
    let end = start;
    for (; end < text.length; end += 1) {
        const char = text[end];
        if (quoteAt[end] !== enclosing) {
            if (enclosing) break;
            continue;
        }
        if (enclosing && char === enclosing) break;
        if (QUOTES.has(char)) {
            if (!enclosing) continue;
            const close = text.indexOf(char, end + 1);
            if (close === -1 || quoteAt[close] !== enclosing) break;
            end = close;
        } else if ((char === '#' || char === '$') && text[end + 1] === '{') {
            interpolation += 1;
            end += 1;
        } else if (char === '}' && interpolation > 0) {
            interpolation -= 1;
        } else if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            if (depth === 0) break;
            depth -= 1;
        } else if (
            VALUE_END.has(char) ||
            (char === ',' && depth === 0 && interpolation === 0)
        ) {
            break;
        }
    }
    return { value: text.slice(start, end), selector: text[end] === '{' };
}

/** A binary operator (or a member access) that carries an expression on. */
const CONTINUES = /[-+*/%=(,?:&|!<>.]$/;
const CONTINUED = /^[-+*/%?:.,&|]/;

/**
 * A JavaScript expression from `start` to its end, across line breaks: a
 * `;`, a closing bracket it did not open, or (with `argument`) a top-level
 * comma. A line break ends it only where the statement is complete, so
 * `600 +\n50` and `600\n+ 50` both read as one expression.
 */
export function codeExpression(text, start, { argument = false } = {}) {
    let depth = 0;
    let quote = '';
    let end = start;
    for (; end < text.length; end += 1) {
        const char = text[end];
        if (quote) {
            if (char === '\\') end += 1;
            else if (char === quote) quote = '';
        } else if (QUOTES.has(char)) {
            quote = char;
        } else if ('([{'.includes(char)) {
            depth += 1;
        } else if (')]}'.includes(char)) {
            if (depth === 0) break;
            depth -= 1;
        } else if (
            depth === 0 &&
            (char === ';' || (argument && char === ','))
        ) {
            break;
        } else if (depth === 0 && char === '\n') {
            const before = text.slice(start, end).trim();
            const after = text.slice(end + 1).trimStart();
            if (before && !CONTINUES.test(before) && !CONTINUED.test(after)) {
                break;
            }
        }
    }
    return text.slice(start, end);
}

/**
 * Whitespace-separated tokens, keeping `var(--x, 650)` and a quoted family
 * such as `"DM Sans"` in one piece.
 */
export function tokensOf(value) {
    const tokens = [];
    let depth = 0;
    let quote = '';
    let current = '';
    for (const char of value.trim()) {
        if (quote) {
            if (char === quote) quote = '';
        } else if (QUOTES.has(char)) {
            quote = char;
        } else if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
        }
        if (!quote && depth === 0 && /\s/.test(char)) {
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
 * Whether `index` sits in a tag's attribute list: scanning the markup before
 * it (the whole file for HTML, the enclosing string for TypeScript), a `<`
 * followed by a letter, `/` or `!` opens a tag, a `>` outside an attribute
 * value closes it, and quoted values are skipped (an escaped `\"` is still a
 * quote to this scan). So
 * `<text aria-label="x > y" font-weight=…>` is inside a tag, while text such
 * as `<p>a < b font-weight=…</p>` or a `title="font-weight=…"` value is not.
 */
export function insideTag({ text, quoteAt }, index, { html = false } = {}) {
    let start = 0;
    if (!html) {
        start = index;
        while (start > 0 && quoteAt[start - 1] === quoteAt[index]) start -= 1;
    }
    const markup = text.slice(start, index);
    let inTag = false;
    let quote = '';
    for (let i = 0; i < markup.length; i += 1) {
        const char = markup[i];
        if (quote) {
            if (char === quote) quote = '';
        } else if (char === '<' && /[a-z/!]/i.test(markup[i + 1] ?? '')) {
            inTag = true;
        } else if (inTag && char === '>') {
            inTag = false;
        } else if (inTag && (char === '"' || char === "'")) {
            quote = char;
        }
    }
    return inTag && !quote;
}

const FLOW = /^@(?:if|else|each|for|while)\b/i;
const CALLABLE = /^@(?:mixin|function)\b/i;

/**
 * What opens the block at `brace`: flow control, a callable (with its name)
 * or a rule.
 */
function kindOf(text, brace) {
    let k = brace - 1;
    while (k >= 0 && !';{}'.includes(text[k])) k -= 1;
    const prelude = text.slice(k + 1, brace).trim();
    if (FLOW.test(prelude)) return { kind: 'flow' };
    const callable = CALLABLE.exec(prelude);
    if (callable) {
        const name = /^@\w+\s+([\w-]+)/.exec(prelude)?.[1] ?? null;
        return { kind: 'callable', name };
    }
    return { kind: 'rule' };
}

/**
 * The `{…}` blocks of a stylesheet as `{ start, end, kind }` (offsets of the
 * braces), skipping braces inside strings. An interpolation `#{…}` is a block
 * too, which is harmless: no declaration sits inside one.
 */
export function blocksOf({ text, quoteAt }) {
    const blocks = [];
    const open = [];
    for (let i = 0; i < text.length; i += 1) {
        if (quoteAt[i]) continue;
        if (text[i] === '{') open.push(i);
        else if (text[i] === '}' && open.length > 0) {
            const start = open.pop();
            blocks.push({ start, end: i, ...kindOf(text, start) });
        }
    }
    return blocks.sort((a, b) => a.start - b.start);
}

/**
 * Where `index` sits in the Sass scope tree. `scopes` lists the scopes a name
 * there resolves through, innermost first and ending in `null` (the module).
 * Flow-control blocks (`@if`, `@each`, …) are not scopes of their own: Sass
 * assigns to the enclosing scope's variable. `scope` is the innermost scope,
 * `conditional` says a flow-control block lies in between, `inCallable`
 * whether a `@mixin`/`@function` body encloses `index`, and `callable` the
 * name of the innermost one.
 */
export function placeOf(blocks, index) {
    const around = blocks
        .filter((block) => block.start < index && index < block.end)
        .reverse();
    const scopes = around
        .filter((block) => block.kind !== 'flow')
        .map((block) => block.start);
    const firstScope = around.findIndex((block) => block.kind !== 'flow');
    return {
        scopes: [...scopes, null],
        scope: scopes[0] ?? null,
        conditional: firstScope === -1 ? around.length > 0 : firstScope > 0,
        inCallable: around.some((block) => block.kind === 'callable'),
        callable:
            around.find((block) => block.kind === 'callable')?.name ?? null,
    };
}

/**
 * The mixin or function an argument at `index` is passed to: the name before
 * the `(` that encloses it (the last segment of `ns.name(`, or the callable's
 * own name for a signature default), or `with` for a `@use … with (…)`.
 */
export function calleeOf(text, index) {
    let depth = 0;
    for (let k = index - 1; k >= 0; k -= 1) {
        if (text[k] === ')') depth += 1;
        else if (text[k] === '(') {
            if (depth === 0) {
                const name = /([\w.-]+)\s*$/.exec(text.slice(0, k))?.[1];
                return name?.split('.').pop() ?? null;
            }
            depth -= 1;
        }
    }
    return null;
}

/** 1-based line of every index, computed once per file. */
export function lineIndex(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '\n') starts.push(i + 1);
    }
    return (index) => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= index) low = middle;
            else high = middle - 1;
        }
        return low + 1;
    };
}
