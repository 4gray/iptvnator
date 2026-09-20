import { Marked, Tokenizer } from 'marked';

// Lex only: no Markdown is rendered and no HTML is sanitized or re-emitted.
const markdownLexer = new Marked({
    tokenizer: {
        reflink(source, links) {
            const token = Tokenizer.prototype.reflink.call(this, source, links);
            if (token?.type !== 'text') return token;

            // Marked otherwise turns unresolved references into ordinary text.
            // Retain explicit full/collapsed forms and shortcut images;
            // a bare [word] without a definition remains ordinary prose.
            const full = this.rules.inline.reflink.exec(source);
            const collapsed = this.rules.inline.nolink.exec(source);
            const match =
                full ??
                (collapsed?.[0].endsWith('[]') ||
                collapsed?.[0].startsWith('![')
                    ? collapsed
                    : undefined);
            if (!match) return token;
            return {
                type: 'unresolved-reference',
                raw: match[0],
                text: match[0],
                label: match[2] || match[1],
            };
        },
    },
});

function inlineText(tokens) {
    return tokens
        .map((token) => {
            if (token.type === 'html') return '';
            if (token.tokens) return inlineText(token.tokens);
            return token.text ?? '';
        })
        .join('');
}

export function guidanceAnchors(markdown) {
    const found = new Set();
    const explicit = new Set();
    markdownLexer.walkTokens(markdownLexer.lexer(markdown), (token) => {
        if (token.type === 'heading') {
            const slug = inlineText(token.tokens)
                .toLowerCase()
                .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '')
                .replace(/\s/gu, '-');
            let unique = slug;
            let suffix = 0;
            while (found.has(unique)) unique = `${slug}-${++suffix}`;
            found.add(unique);
        }
        if (token.type === 'html') {
            for (const match of token.raw.matchAll(
                /<(?:a|[a-z][\w-]*)\b[^>]*\b(?:id|name)=["']([^"']+)["']/giu
            ))
                explicit.add(match[1]);
        }
    });
    return new Set([...found, ...explicit]);
}

function isLiteralRepositoryPath(token) {
    // A typo in the directory or a new root filename must still be checked.
    // Exclude recognizable prose/code forms instead of allowlisting paths.
    if (/^(?:@|--|[a-z][a-z\d+.-]*:|\/\/)/iu.test(token)) return false;
    if (/[^\p{L}\p{N}_./#-]/u.test(token)) return false;
    if (token.includes('YYYY-MM-DD') || /(?:^|\/)\.\.\.(?:\/|$)/u.test(token))
        return false;
    const path = token.split('#')[0];
    // Bare dotted identifiers are ambiguous. Recognize conventional file
    // suffixes; other filenames can be made explicit with ./ or a Markdown link.
    // This applies to user-defined symbols as well as JavaScript globals.
    if (
        /^[\p{L}_][\p{L}\p{N}_]*(?:\.[\p{L}_][\p{L}\p{N}_]*)+$/u.test(path) &&
        !/\.(?:md|mdx|json|jsonc|ya?ml|[cm]?[jt]sx?|html?|css|scss|sass|less|toml|xml|txt|sh|py|sql|svg|png|jpe?g|webp|gif|m3u8?|conf|ini|lock)$/iu.test(
            path
        )
    )
        return false;
    return (
        path.includes('/') ||
        /^(?:\.[\p{L}\p{N}_-]+|[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.[\p{L}][\p{L}\p{N}_-]*)$/u.test(
            path
        )
    );
}

export function guidanceReferences(markdown, includeLiterals) {
    const result = [];
    const destinations = new Set();
    function add(target, literal = false) {
        const key = `${literal}:${target}`;
        if (!destinations.has(key)) {
            destinations.add(key);
            result.push({ target, literal });
        }
    }
    markdownLexer.walkTokens(markdownLexer.lexer(markdown), (token) => {
        if (['link', 'image', 'def'].includes(token.type)) add(token.href);
        if (token.type === 'unresolved-reference')
            result.push({ unresolvedReference: token.label });
        if (
            includeLiterals &&
            token.type === 'codespan' &&
            isLiteralRepositoryPath(token.text)
        )
            add(token.text, true);
    });
    return result;
}
