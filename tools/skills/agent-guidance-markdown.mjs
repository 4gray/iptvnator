import GithubSlugger from 'github-slugger';
import { Marked, Tokenizer } from 'marked';
import { parseFragment } from 'parse5';

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
            return token.type === 'text'
                ? decodeEntities(token.text ?? '')
                : (token.text ?? '');
        })
        .join('');
}

function decodeEntities(text) {
    return text.replace(
        /&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/giu,
        (entity) => parseFragment(entity).childNodes[0]?.value ?? entity
    );
}

function htmlNavigation(html) {
    const anchors = [];
    const references = [];
    function visit(node) {
        if (['script', 'style', 'template'].includes(node.tagName)) return;
        for (const attribute of node.attrs ?? []) {
            if (
                attribute.name === 'id' ||
                (node.tagName === 'a' && attribute.name === 'name')
            )
                anchors.push(attribute.value);
            if (
                (node.tagName === 'a' && attribute.name === 'href') ||
                (node.tagName === 'img' && attribute.name === 'src')
            )
                references.push(attribute.value);
        }
        for (const child of node.childNodes ?? []) visit(child);
    }
    visit(parseFragment(html));
    return { anchors, references };
}

export function guidanceProse(markdown) {
    function prose(token) {
        if (['code', 'codespan', 'html'].includes(token.type)) return '';
        if (token.items) return token.items.map(prose).join('\n');
        if (token.tokens) return token.tokens.map(prose).join('');
        return token.text ?? '';
    }
    return markdownLexer.lexer(markdown).map(prose).join('\n');
}

export function guidanceStandaloneImports(markdown) {
    return markdownLexer
        .lexer(markdown)
        .filter((token) => token.type === 'paragraph')
        .flatMap((token) => [
            ...token.raw.matchAll(/^ {0,3}@([^\s]+)[\t ]*$/gmu),
        ])
        .map((match) => match[1]);
}

export function guidanceAnchors(markdown) {
    const slugger = new GithubSlugger();
    const found = new Set();
    const html = [];
    markdownLexer.walkTokens(markdownLexer.lexer(markdown), (token) => {
        if (token.type === 'heading') {
            found.add(slugger.slug(inlineText(token.tokens)));
        }
        if (token.type === 'html') html.push(token.raw);
    });
    return new Set([...found, ...htmlNavigation(html.join('\n')).anchors]);
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
        /^(?:\.[\p{L}\p{N}_-][\p{L}\p{N}_.-]*|[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.[\p{L}][\p{L}\p{N}_-]*)$/u.test(
            path
        )
    );
}

export function guidanceReferences(markdown, includeLiterals) {
    const result = [];
    const destinations = new Set();
    const html = [];
    function add(target, literal = false) {
        const key = `${literal}:${target}`;
        if (!destinations.has(key)) {
            destinations.add(key);
            result.push({ target, literal });
        }
    }
    markdownLexer.walkTokens(markdownLexer.lexer(markdown), (token) => {
        if (['link', 'image', 'def'].includes(token.type)) add(token.href);
        if (token.type === 'html') html.push(token.raw);
        if (token.type === 'unresolved-reference')
            result.push({ unresolvedReference: token.label });
        if (
            includeLiterals &&
            token.type === 'codespan' &&
            isLiteralRepositoryPath(token.text)
        )
            add(token.text, true);
    });
    for (const target of htmlNavigation(html.join('\n')).references)
        add(target);
    return result;
}
