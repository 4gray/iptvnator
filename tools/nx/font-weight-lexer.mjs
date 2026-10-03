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
    // SVG is markup like HTML: attributes, `<!-- -->` comments, `<style>`.
    if (/\.(?:html|svg)$/.test(file)) return { html: true, quotes: ['"', "'"] };
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

const CONDITION_PRELUDE = /^@(?:supports|media|container)\b/i;

/**
 * Whether `index` sits in a conditional at-rule's prelude, such as the test
 * of `@supports (font-weight: 650) {…}`, which is a condition rather than a
 * declaration. A mixin call's arguments (`@include m($w: 650)`) do count.
 */
export function inConditionPrelude({ text, quoteAt }, index) {
    const start = preludeStart(text, quoteAt, index);
    return CONDITION_PRELUDE.test(text.slice(start, index).trimStart());
}

/**
 * Where the statement or prelude that `index` sits in starts: just after the
 * `;`, `{` or `}` before it, skipping strings and Sass interpolations
 * (`@supports (min-width: #{10}px) and …`).
 */
function preludeStart(text, quoteAt, index) {
    let k = index - 1;
    while (k >= 0) {
        if (quoteAt[k]) {
            k -= 1;
        } else if (text[k] === '}') {
            const open = openingBrace(text, quoteAt, k);
            if (open <= 0 || text[open - 1] !== '#') break;
            k = open - 2;
        } else if (text[k] === ';' || text[k] === '{') {
            break;
        } else {
            k -= 1;
        }
    }
    return k + 1;
}

/** The `{` that the `}` at `close` closes, skipping strings, or -1. */
function openingBrace(text, quoteAt, close) {
    let depth = 0;
    for (let i = close; i >= 0; i -= 1) {
        if (quoteAt[i]) continue;
        if (text[i] === '}') depth += 1;
        else if (text[i] === '{' && (depth -= 1) === 0) return i;
    }
    return -1;
}

/** The `}` that closes the `{` at `open`, skipping strings. */
export function closingBrace({ text, quoteAt }, open) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
        if (quoteAt[i]) continue;
        if (text[i] === '{') depth += 1;
        else if (text[i] === '}' && --depth === 0) return i;
    }
    return text.length;
}

/**
 * Whether `index` sits in an unquoted `style=font-weight:650` attribute
 * value, which runs to a space or `>`.
 */
export function inUnquotedStyle(lexed, index) {
    const attribute = /(?:^|[\s<])style\s*=\s*[^\s"'=<>`]*$/i;
    return (
        attribute.test(lexed.text.slice(0, index)) &&
        insideTag(lexed, index, { html: true })
    );
}

/**
 * Whether `index` sits where markup holds CSS: a `<style>` element, a
 * `style` attribute, or an Angular style binding (`[style]`, `[style.x]`,
 * `[ngStyle]`, `[attr.style]`, whose strings are CSS). Text content and
 * other attributes or bindings (`[title]="'font-weight: 650'"`) are not.
 */
export function inMarkupCss({ text, quoteAt }, index) {
    const before = text.slice(0, index).toLowerCase();
    const open = before.lastIndexOf('<style');
    if (open !== -1 && !before.includes('</style', open)) {
        if (/^<style[\s>]/.test(before.slice(open, open + 7))) return true;
    }
    const quote = quoteAt[index];
    if (!quote) return inUnquotedStyle({ text, quoteAt }, index);
    let start = index;
    while (start > 0 && quoteAt[start - 1] === quote) start -= 1;
    const name = /([^\s<>="']+)\s*=\s*$/.exec(text.slice(0, start - 1))?.[1];
    return /^(?:style|\[(?:style(?:\.[^\]]+)?|ngStyle|attr\.style)\])$/i.test(
        name ?? ''
    );
}

const BINDING_VALUE = /\[[^\]\s="'<>]+\]\s*=\s*(?:"([^"]*)|'([^']*))$/;

/**
 * Where `index` sits in an Angular binding's value: `quote` is the string
 * literal open there (`''` in code), `attribute` the quote that ends the
 * value; `null` outside a binding. An escaped quote (`'it\'s'`) is text.
 */
function bindingAt(text, index) {
    const before = text.slice(Math.max(0, index - 4096), index);
    const binding = BINDING_VALUE.exec(before);
    if (!binding) return null;
    const value = binding[1] ?? binding[2];
    let quote = '';
    for (let i = 0; i < value.length; i += 1) {
        if (quote && value[i] === '\\') i += 1;
        else if (quote) quote = value[i] === quote ? '' : quote;
        else if (QUOTES.has(value[i])) quote = value[i];
    }
    return { quote, attribute: binding[1] === undefined ? "'" : '"' };
}

/**
 * Whether `index` sits in an Angular binding's value (`[ngStyle]="{…}"`),
 * which is code, and not in a string literal inside it, which is CSS text.
 */
export function inBinding(text, index) {
    return bindingAt(text, index)?.quote === '';
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
    // Markup `<style>` content is CSS: block comments and strings there.
    let styleTag = false;
    let inStyle = false;
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
        } else if (syntax.html && inStyle && source.startsWith('/*', i)) {
            i = blank(i, until('*/', i + 2));
        } else if (syntax.html) {
            if (char === '<') {
                inTag = true;
                const tag = source.slice(i, i + 8).toLowerCase();
                if (/^<style[\s>]/.test(tag)) styleTag = true;
                if (/^<\/style[\s>]/.test(tag)) inStyle = false;
            }
            if (char === '>') {
                inTag = false;
                if (styleTag) inStyle = true;
                styleTag = false;
            }
            const css = inStyle && !inTag;
            if ((inTag || css) && syntax.quotes.includes(char)) quote = char;
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

/**
 * The string literal of code that encloses `index` (a TypeScript string, or
 * one inside an Angular binding's value): its closing quote's position
 * (`close`) and where the code around it ends (`limit`: the file's end, or
 * the binding attribute's closing quote). `null` outside one.
 */
export function codeStringAt({ text, quoteAt }, file, index) {
    if (file.endsWith('.ts')) {
        const quote = quoteAt[index];
        let close = index;
        while (close + 1 < text.length && quoteAt[close + 1] === quote) {
            close += 1;
        }
        return quote ? { close, limit: text.length } : null;
    }
    const binding = bindingAt(text, index);
    if (!binding?.quote) return null;
    const close = text.indexOf(binding.quote, index);
    const limit = text.indexOf(binding.attribute, close + 1);
    return close !== -1 && limit !== -1 ? { close, limit } : null;
}

/**
 * The code a string's CSS text continues with: the first operand after a
 * `+` right after the string that adds more than whitespace
 * (`'font-weight:' + ' ' + 650 + ';'` gives `650`), or `null` when no `+`
 * follows.
 */
export function concatenatedAfter(text, { close, limit }) {
    const code = text.slice(0, limit);
    const plus = /^\s*\+\s*/.exec(code.slice(close + 1));
    if (!plus) return null;
    const start = close + 1 + plus[0].length;
    const expression = codeExpression(code, start, { argument: true });
    const operands = splitAt(expression, ['+']);
    const blank = /^\s*(['"`])\s*\1\s*$/;
    return operands.find((operand) => !blank.test(operand)) ?? '';
}

/**
 * A template literal's body split into text and `${…}` code, in order
 * (`65${0}` is `[{ text: '65' }, { code: '0' }]`). An escaped character is
 * text.
 */
export function templateParts(body) {
    const parts = [];
    let text = '';
    for (let i = 0; i < body.length; i += 1) {
        if (body[i] === '\\') {
            text += body[i + 1] ?? '';
            i += 1;
            continue;
        }
        const code = body.startsWith('${', i)
            ? codeExpression(body, i + 2)
            : null;
        if (code === null) {
            text += body[i];
            continue;
        }
        if (text) parts.push({ text });
        text = '';
        parts.push({ code });
        i += 2 + code.length;
    }
    if (text) parts.push({ text });
    return parts;
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
 * Whitespace-separated tokens, keeping `var(--x, 650)`, a quoted family
 * such as `"DM Sans"` and an escaped space in one piece.
 */
export function tokensOf(value) {
    const tokens = [];
    let depth = 0;
    let quote = '';
    let current = '';
    const text = value.trim();
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        // An escaped character (`JetBrains\ Mono`) is text.
        if (char === '\\') {
            current += text.slice(i, i + 2);
            i += 1;
            continue;
        }
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
function kindOf(text, quoteAt, brace) {
    const prelude = text
        .slice(preludeStart(text, quoteAt, brace), brace)
        .trim();
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
            blocks.push({ start, end: i, ...kindOf(text, quoteAt, start) });
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

/** A CSS escape: up to six hex digits (one whitespace after them ends it). */
const ESCAPE = /\\(?:([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?|([^\n\r\f]))/iy;

/** The name characters `text` ends with (`font-w` in `.x { font-w`). */
function trailingName(text) {
    let start = text.length;
    while (start > 0 && /[\w-]/.test(text[start - 1])) start -= 1;
    return text.slice(start);
}

/**
 * The name character an escape decodes to after `name` (the name characters
 * before it), or `''` where it stays an escape: past ASCII, outside a name,
 * or a digit or `-` that would start one.
 */
function escapedName(escape, name) {
    const code = escape[1] ? Number.parseInt(escape[1], 16) : null;
    const char = code === null ? escape[2] : String.fromCharCode(code);
    if ((code !== null && code >= 0x80) || !/^[\w-]$/.test(char)) return '';
    if (/^(?:-?[a-z_]|--)/i.test(name)) return char;
    return /^-?$/.test(name) && /^[a-z_]$/i.test(char) ? char : '';
}

/**
 * `source` with the CSS escapes that Sass and the browser read as plain name
 * characters decoded (`font-w\65 ight` is `font-weight`, `b\6f ld` is
 * `bold`, `--w\65 ight` is `--weight`), and `origin`, the offset in `source`
 * of each position (`null` when nothing changed). An escape stays where its
 * character would change the token, as Sass leaves it: a digit or `-`
 * starting a name (`\36 50` is a name, not 650), anything after a number
 * (`6\35 0`, `6\65 2`), and a character no name has (`\:`, `\20`, `\'`).
 * Comments and TypeScript are left as written (TypeScript strings use
 * JavaScript escapes).
 */
export function decodeEscapes(file, source) {
    if (file.endsWith('.ts') || !source.includes('\\')) {
        return { text: source, origin: null };
    }
    // A comment is no CSS: `// note \65` must not take the next line.
    const plain = lex(file, source).text;
    let text = '';
    const origin = [];
    for (let i = 0; i < source.length; i += 1) {
        ESCAPE.lastIndex = i;
        const escape = plain[i] === '\\' ? ESCAPE.exec(source) : null;
        const length = escape ? escape[0].length : 1;
        const char = escape ? escapedName(escape, trailingName(text)) : '';
        if (char) {
            text += char;
            origin.push(i);
        } else {
            text += source.slice(i, i + length);
            for (let k = i; k < i + length; k += 1) origin.push(k);
        }
        i += length - 1;
    }
    origin.push(source.length);
    return { text, origin };
}

/**
 * A character reference markup decodes: numeric (`&#54;`, `&#x36;`, the `;`
 * optional) or named, and the named ones CSS text can use.
 */
const REFERENCE = /&(?:#(\d+);?|#x([\da-f]+);?|([a-z]+);)/iy;
const NAMED = Object.freeze({
    ...{ quot: '"', QUOT: '"', apos: "'", colon: ':', semi: ';', excl: '!' },
    ...{ lpar: '(', rpar: ')', comma: ',', period: '.', plus: '+', sol: '/' },
    ...{ bsol: '\\', percnt: '%', lowbar: '_', num: '#', Tab: '\t' },
    ...{ NewLine: '\n', nbsp: '\u00a0' },
});

/**
 * The text a reference stands for inside `quote` (the quoted attribute
 * value's quote, or `''`), or `''` where it stays as written: `<` and `>`
 * would change the markup, so they never decode, and the value's own quote
 * decodes as the other one (CSS reads both alike).
 */
function referenced(reference, quote) {
    const [, decimal, hex, name] = reference;
    const code = decimal ?? hex;
    let char = Object.hasOwn(NAMED, name ?? '') ? NAMED[name] : '';
    if (code !== undefined) {
        // Past the last code point it is U+FFFD (`fromCodePoint` throws).
        const point = Number.parseInt(code, decimal ? 10 : 16);
        char = point > 0x10ffff ? '\uFFFD' : String.fromCodePoint(point);
    }
    if ('<>'.includes(char)) return '';
    if (char !== quote) return char;
    return quote === '"' ? "'" : '"';
}

/**
 * Where markup keeps its references as written: HTML's `<style>` and
 * `<script>` text, and an SVG's CDATA sections.
 */
function rawRanges(file, source) {
    const raw = file.endsWith('.svg')
        ? /<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/g
        : /<(style|script)\b[^>]*>[\s\S]*?(?:<\/\1|$)/gi;
    return [...source.matchAll(raw)].map((m) => [
        m.index,
        m.index + m[0].length,
    ]);
}

/**
 * Markup with its character references decoded as the browser decodes them
 * (`style="font-weight: &#x36;50"` is 650), outside comments and raw text,
 * and `origin` as in `decodeEscapes`.
 */
export function decodeReferences(file, source) {
    if (!/\.(?:html|svg)$/.test(file) || !source.includes('&')) {
        return { text: source, origin: null };
    }
    const { text: plain, quoteAt } = lex(file, source);
    const raw = rawRanges(file, source);
    let text = '';
    const origin = [];
    for (let i = 0; i < source.length; i += 1) {
        REFERENCE.lastIndex = i;
        const kept = plain[i] !== '&' || raw.some(([a, b]) => a <= i && i < b);
        const reference = kept ? null : REFERENCE.exec(source);
        const length = reference ? reference[0].length : 1;
        const char = reference ? referenced(reference, quoteAt[i]) : '';
        if (char) {
            text += char;
            for (let k = 0; k < char.length; k += 1) origin.push(i);
        } else {
            text += source.slice(i, i + length);
            for (let k = i; k < i + length; k += 1) origin.push(k);
        }
        i += length - 1;
    }
    origin.push(source.length);
    return { text, origin };
}

/**
 * A file as the browser reads it: markup references, then CSS escapes,
 * decoded; `origin` maps each position back to `written` (`null` when
 * nothing changed).
 */
export function decodeSource(file, written) {
    const references = decodeReferences(file, written);
    const escapes = decodeEscapes(file, references.text);
    if (!escapes.origin) return references;
    const { origin } = references;
    return {
        text: escapes.text,
        origin: origin ? escapes.origin.map((i) => origin[i]) : escapes.origin,
    };
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
