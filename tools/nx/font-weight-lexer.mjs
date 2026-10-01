/**
 * Just enough lexing for `check-font-weights.mjs`: comments, the string that
 * encloses each position, and where a declaration's value ends.
 */

const QUOTES = new Set(["'", '"', '`']);
const VALUE_END = new Set([';', '{', '}', ']']);

/**
 * Plain CSS has block comments only; SCSS and TypeScript add `//`. In SCSS
 * a `//` is a comment anywhere outside a string (`font-weight:// old`, `(//
 * note`) except in an unquoted `url(//cdn…)` or `url(https://…)`. In
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
 * Whether `index` sits in an unquoted `url(…)` on its line, whose `//` is a
 * URL; a `url(` that a comment ends with leaves the next line alone.
 */
function inUrl(source, index) {
    const line = source.slice(source.lastIndexOf('\n', index - 1) + 1, index);
    return /url\(\s*[^\s)'"]*$/i.test(line);
}

/**
 * Whether `index` sits in an Angular binding's value (`[ngStyle]="{…}"`),
 * which is code, and not in a string literal inside it, which is CSS text.
 */
export function inBinding(text, index) {
    const before = text.slice(Math.max(0, index - 4096), index);
    const binding = /\[[^\]\s="'<>]+\]\s*=\s*(?:"([^"]*)|'([^']*))$/.exec(
        before
    );
    if (!binding) return false;
    const value = binding[1] ?? binding[2];
    const inner = binding[1] === undefined ? '"' : "'";
    const count = (quote) => value.split(quote).length - 1;
    return count(inner) % 2 === 0 && count('`') % 2 === 0;
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
            !(syntax.protocol && inUrl(source, i))
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

/** The bracket depth at each position of code, or -1 inside a string. */
function depthsOf(text) {
    const depths = new Array(text.length).fill(-1);
    let depth = 0;
    let quote = '';
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote) {
            if (char === '\\') i += 1;
            else if (char === quote) quote = '';
        } else if (QUOTES.has(char)) {
            quote = char;
        } else {
            if (')]}'.includes(char)) depth -= 1;
            depths[i] = depth;
            if ('([{'.includes(char)) depth += 1;
        }
    }
    return depths;
}

/** Where `text` splits at a top-level operator from `operators`. */
function splitAt(text, operators) {
    const depths = depthsOf(text);
    const parts = [];
    let from = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (depths[i] !== 0 || i < from) continue;
        const operator = operators.find((op) => text.startsWith(op, i));
        // `||=` and kin assign; `=>` and `<<`/`>>` are not comparisons.
        if (!operator || /^[=<>]/.test(text[i + operator.length] ?? '')) {
            continue;
        }
        if (/[=<>!]/.test(text[i - 1] ?? '')) continue;
        parts.push(text.slice(from, i));
        from = i + operator.length;
    }
    return [...parts, text.slice(from)];
}

/** The branches of a top-level `c ? a : b`, or `null`. */
function branchesOf(text) {
    const depths = depthsOf(text);
    let question = -1;
    let nested = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (depths[i] !== 0) continue;
        if (text[i] === '?') {
            // `??` is nullish; `?.` chains, unless a digit follows (`?.5`).
            const pair = text[i + 1] === '?' || text[i - 1] === '?';
            const chain = text[i + 1] === '.' && !/\d/.test(text[i + 2] ?? '');
            if (pair || chain) continue;
            if (question === -1) question = i;
            else nested += 1;
        } else if (text[i] === ':' && question !== -1) {
            if (nested === 0) {
                return [text.slice(question + 1, i), text.slice(i + 1)];
            }
            nested -= 1;
        }
    }
    return null;
}

const COMPARISONS = ['===', '!==', '==', '!=', '<=', '>=', '<', '>'];

/**
 * What a JavaScript expression can evaluate to, as sub-expressions: both
 * branches of `c ? a : b`, every operand of `||`, `??` and `&&`, and nothing
 * for a comparison, which is a boolean. A condition never becomes the value,
 * so `width >= 768 ? 700 : 600` is 700 or 600.
 */
export function resultsOf(expression) {
    let text = expression.trim();
    // `(…)` around the whole expression.
    while (
        text.startsWith('(') &&
        text.endsWith(')') &&
        depthsOf(text)
            .slice(1, -1)
            .every((depth) => depth !== 0)
    ) {
        text = text.slice(1, -1).trim();
    }
    const branches = branchesOf(text);
    if (branches) return branches.flatMap(resultsOf);
    const operands = splitAt(text, ['||', '??', '&&']);
    if (operands.length > 1) return operands.flatMap(resultsOf);
    if (splitAt(text, COMPARISONS).length > 1) return [];
    return [text];
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

/** Sass reads `-` and `_` in a name alike; callable names keep `-`. */
const callableName = (name) => name?.replace(/_/g, '-') ?? null;

/**
 * Whether `index` follows `@mixin` or `@function` and whitespace (blanked
 * comments included), so the name there opens a signature, not a call.
 */
export function namesCallable(text, index) {
    let k = index;
    while (k > 0 && /\s/.test(text[k - 1])) k -= 1;
    return (
        k < index &&
        /@(?:mixin|function)$/i.test(text.slice(Math.max(0, k - 9), k))
    );
}

/**
 * What opens the block at `brace`: flow control, a callable (with its name,
 * `_` read as `-`) or a rule, with its `prelude` (the selector or at-rule).
 */
function kindOf(text, brace) {
    let k = brace - 1;
    while (k >= 0 && !';{}'.includes(text[k])) k -= 1;
    const prelude = text.slice(k + 1, brace).trim();
    if (FLOW.test(prelude)) return { kind: 'flow', prelude };
    const callable = CALLABLE.exec(prelude);
    if (callable) {
        const name = /^@\w+\s+([\w-]+)/.exec(prelude)?.[1];
        return { kind: 'callable', name: callableName(name), prelude };
    }
    return { kind: 'rule', prelude };
}

/**
 * The `{…}` blocks of a stylesheet as `{ start, end, kind, prelude }` (offsets of the
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
 * `conditional` says a flow-control block lies in between, `flow` that one
 * encloses `index` at any depth, `inCallable`
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
        flow: around.some((block) => block.kind === 'flow'),
        inCallable: around.some((block) => block.kind === 'callable'),
        callable:
            around.find((block) => block.kind === 'callable')?.name ?? null,
    };
}

/** `ns.name` as `{ name, namespace }`, with `_` read as `-`. */
function calleeNamed(full) {
    const parts = full.split('.');
    const name = parts.pop();
    return { name: callableName(name), namespace: parts.pop() ?? null };
}

/**
 * The mixin or function an argument at `index` is passed to, as
 * `{ name, namespace, paren, signature }`: the name before the `(` that
 * encloses it (`ns.name(` gives both; `_` reads as `-`), or `with` for a
 * `@use … with (…)`. `paren` is where that `(` sits; `signature` says it
 * opens a `@mixin`/`@function` parameter list, so the argument is a default.
 */
export function calleeOf(text, index) {
    let depth = 0;
    for (let k = index - 1; k >= 0; k -= 1) {
        if (text[k] === ')') depth += 1;
        else if (text[k] === '(') {
            if (depth === 0) {
                const named = /([\w.-]+)\s*$/.exec(text.slice(0, k));
                if (!named) return null;
                return {
                    ...calleeNamed(named[1]),
                    paren: k,
                    signature: namesCallable(text, named.index),
                };
            }
            depth -= 1;
        }
    }
    return null;
}

const INVOCATION =
    /@include\s+([\w.-]+)|(?<![\w$.@#-])([\w-]+(?:\.[\w-]+)?)(?=\s*\()/gi;

/**
 * Every mixin include and function call in a stylesheet, as
 * `{ index, paren, callee }`: `paren` is where its argument list opens, or
 * `null` for an `@include name;` without one. Strings and the names in
 * `@mixin`/`@function` signatures are skipped.
 */
export function invocationsOf({ text, quoteAt }) {
    const calls = [];
    for (const match of text.matchAll(INVOCATION)) {
        if (quoteAt[match.index] || namesCallable(text, match.index)) continue;
        const end = match.index + match[0].length;
        const open = /^\s*\(/.exec(text.slice(end));
        calls.push({
            index: match.index,
            paren: open ? end + open[0].length - 1 : null,
            callee: calleeNamed(match[1] ?? match[2]),
        });
    }
    return calls;
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
