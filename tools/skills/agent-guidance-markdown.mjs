import { randomUUID } from 'node:crypto';
import parseSrcset from 'parse-srcset';
import GithubSlugger from 'github-slugger';
import { Marked, Tokenizer } from 'marked';
import { parseFragment } from 'parse5';

// Inspection only: generated HTML is parsed in memory, never executed or emitted.
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

function decodeEntities(text, attribute = false) {
    if (attribute) {
        const html = `<a href="${text.replace(/"/gu, '&quot;')}"></a>`;
        return parseFragment(html).childNodes[0].attrs[0].value;
    }
    // RCDATA decodes the full HTML character-reference grammar without
    // interpreting literal tags. The prefix preserves an initial newline.
    const html = `<textarea>x${text.replace(/</gu, '&lt;')}</textarea>`;
    return parseFragment(html).childNodes[0].childNodes[0].value.slice(1);
}

function htmlNavigation(html, inspect = () => {}) {
    const anchors = [];
    const references = [];
    function visit(node) {
        if (['script', 'style', 'template'].includes(node.tagName)) return;
        inspect(node);
        for (const attribute of node.attrs ?? []) {
            if (
                attribute.name === 'id' ||
                (node.tagName === 'a' && attribute.name === 'name')
            )
                anchors.push(attribute.value);
            if (
                (node.tagName === 'a' && attribute.name === 'href') ||
                (['img', 'video', 'audio', 'source', 'track'].includes(
                    node.tagName
                ) &&
                    attribute.name === 'src') ||
                (node.tagName === 'video' && attribute.name === 'poster')
            )
                references.push({
                    target: attribute.value,
                    image: node.tagName !== 'a',
                });
            if (
                ['img', 'source'].includes(node.tagName) &&
                attribute.name === 'srcset'
            )
                for (const candidate of parseSrcset(attribute.value))
                    references.push({ target: candidate.url, image: true });
        }
        for (const child of node.childNodes ?? []) visit(child);
    }
    visit(parseFragment(html));
    return { anchors, references };
}

export function guidanceProse(markdown) {
    function text(node) {
        if (
            ['script', 'style', 'template', 'pre', 'code'].includes(
                node.tagName
            )
        )
            return ' ';
        if (node.nodeName === '#text') return node.value;
        const content = (node.childNodes ?? []).map(text).join('');
        return [
            'p',
            'li',
            'blockquote',
            'div',
            'br',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
        ].includes(node.tagName)
            ? content + '\n'
            : content;
    }
    return text(parseFragment(new Marked().parse(markdown)));
}

export function guidanceStandaloneImports(markdown) {
    const candidates = markdownLexer
        .lexer(markdown)
        .filter((token) => token.type === 'paragraph')
        .flatMap((token) => [
            ...token.raw.matchAll(/^ {0,3}@([^\s]+)[\t ]*$/gmu),
        ])
        .map((match) => match[1]);
    // Markdown can split an HTML container across several top-level tokens.
    // Check the parsed output tree as well as raw source formatting. Only text
    // directly inside a root paragraph can supply the standalone directive.
    const document = parseFragment(new Marked().parse(markdown));
    const visible = new Map();
    for (const node of document.childNodes) {
        if (node.tagName !== 'p') continue;
        const text = node.childNodes
            .map((child) =>
                child.nodeName === '#text' ? child.value : '\uFFFC'
            )
            .join('');
        for (const match of text.matchAll(/^ {0,3}@([^\s]+)[\t ]*$/gmu))
            visible.set(match[1], (visible.get(match[1]) ?? 0) + 1);
    }
    return candidates.filter((candidate) => {
        const count = visible.get(candidate) ?? 0;
        if (!count) return false;
        visible.set(candidate, count - 1);
        return true;
    });
}

export function guidanceAnchors(markdown) {
    const slugger = new GithubSlugger();
    const found = new Set();
    const headings = [];
    const marker = `data-guidance-${randomUUID()}`;
    const renderer = new Marked({
        renderer: {
            heading(token) {
                const index = headings.push(inlineText(token.tokens)) - 1;
                return `<h${token.depth} ${marker}="${index}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
            },
        },
    });
    const navigation = htmlNavigation(renderer.parse(markdown), (node) => {
        const attribute = node.attrs?.find((attr) => attr.name === marker);
        if (attribute)
            found.add(slugger.slug(headings[Number(attribute.value)]));
    });
    return new Set([...found, ...navigation.anchors]);
}

function isLiteralRepositoryPath(token) {
    // A typo in the directory or a new root filename must still be checked.
    // Exclude recognizable prose/code forms instead of allowlisting paths.
    if (/^(?:@|--|[a-z][a-z\d+.-]*:|\/\/)/iu.test(token)) return false;
    const explicitRelative = /^(?:\.\/|\.\.\/)/u.test(token);
    if (
        (explicitRelative
            ? /[^\p{L}\p{N}_./# -]/u
            : /[^\p{L}\p{N}_./#-]/u
        ).test(token)
    )
        return false;
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
        /^(?:Dockerfile|Containerfile|Makefile|GNUmakefile|Justfile|Procfile|Gemfile|Rakefile|Vagrantfile|LICENSE|LICENCE|NOTICE|COPYING|AUTHORS|CONTRIBUTORS|README|CHANGELOG)$/u.test(
            path
        ) ||
        /^(?:\.[\p{L}\p{N}_-][\p{L}\p{N}_.-]*|[\p{L}\p{N}_-][\p{L}\p{N}_.-]*\.[\p{L}][\p{L}\p{N}_-]*)$/u.test(
            path
        )
    );
}

export function guidanceReferences(markdown, includeLiterals) {
    const tokens = markdownLexer.lexer(markdown);
    const markerTag = `guidance-reference-${randomUUID()}`;
    const metadata = [];
    function mark(token, reference) {
        const index = metadata.push(reference) - 1;
        token.type = 'html';
        token.raw = `<${markerTag} data-index="${index}"></${markerTag}>`;
        token.text = token.raw;
    }
    markdownLexer.walkTokens(tokens, (token) => {
        if (token.type === 'def')
            mark(token, {
                target: decodeEntities(token.href, true),
                definition: true,
            });
        else if (token.type === 'unresolved-reference')
            mark(token, { unresolvedReference: token.label });
        else if (
            includeLiterals &&
            token.type === 'codespan' &&
            isLiteralRepositoryPath(token.text)
        )
            mark(token, { target: token.text, literal: true });
    });
    // Let Markdown rendering and HTML tree construction retain container context
    // for ordinary links and for metadata that has no rendered navigation node.
    const visible = [];
    const navigation = htmlNavigation(new Marked().parser(tokens), (node) => {
        if (node.tagName !== markerTag) return;
        const index = Number(
            node.attrs.find((attr) => attr.name === 'data-index')?.value
        );
        if (metadata[index]) visible.push(metadata[index]);
    });
    const result = [];
    const seen = new Set();
    function add(reference) {
        const key = JSON.stringify(reference);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(reference);
        }
    }
    for (const reference of navigation.references) add(reference);
    const usedTargets = new Set(
        navigation.references.map((reference) => reference.target)
    );
    for (const { definition, ...reference } of visible) {
        if (!definition || !usedTargets.has(reference.target)) add(reference);
    }
    return result;
}
