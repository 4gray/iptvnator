import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SURFACES = [
    'AGENTS.md',
    'CLAUDE.md',
    'docs/maintenance/agent-context-map.md',
    'docs/maintenance/agent-guidance-migration.md',
];
const LIMITS = { 'AGENTS.md': [200, 16384], 'CLAUDE.md': [30, 2048] };

function within(root, path) {
    const local = relative(root, path);
    return (
        !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`)
    );
}

// Deliberately scoped to authored guidance, not a general Markdown crawler.
function withoutFences(markdown) {
    let fence;
    return markdown
        .split(/\r?\n/u)
        .map((line) => {
            const match = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
            if (match) {
                if (!fence) fence = match[1];
                else if (
                    match[1][0] === fence[0] &&
                    match[1].length >= fence.length
                )
                    fence = undefined;
                return '';
            }
            return fence ? '' : line;
        })
        .join('\n');
}

function anchors(markdown) {
    const found = new Set();
    for (const match of withoutFences(markdown).matchAll(
        /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gmu
    )) {
        const slug = match[1]
            .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
            .replace(/<[^>]*>/gu, '')
            .toLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '')
            .replace(/\s/gu, '-');
        let unique = slug;
        let suffix = 0;
        while (found.has(unique)) unique = `${slug}-${++suffix}`;
        found.add(unique);
    }
    for (const match of markdown.matchAll(
        /<(?:a|[a-z][\w-]*)\b[^>]*\b(?:id|name)=["']([^"']+)["']/giu
    )) {
        found.add(match[1]);
    }
    return found;
}

function references(markdown, includeLiterals) {
    const text = withoutFences(markdown);
    const result = [];
    // Inline destinations may use angle brackets or an optional quoted title.
    const prose = text.replace(/`[^`\n]+`/gu, '');
    for (const match of prose.matchAll(
        /\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/gu
    )) {
        result.push({ target: match[1] ?? match[2], literal: false });
    }
    for (const match of prose.matchAll(
        /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gmu
    )) {
        result.push({ target: match[1] ?? match[2], literal: false });
    }
    if (includeLiterals) {
        for (const match of text.matchAll(/`([^`\r\n]+)`/gu)) {
            const token = match[1];
            const local =
                /^(?:apps|libs|docs|tools|patches|\.codex|\.claude|\.github|\.changes|\.plans)\//u.test(
                    token
                ) ||
                /^(?:AGENTS\.md|CLAUDE\.md|README\.md|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|nx\.json|tsconfig\.base\.json|eslint\.config\.mjs|\.nvmrc)$/u.test(
                    token
                );
            if (
                local &&
                !/[\s*?[\]{}<>|]/u.test(token) &&
                !token.includes('YYYY-MM-DD')
            )
                result.push({ target: token, literal: true });
        }
    }
    return result;
}

async function validateReference(rootDir, source, { target, literal }) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target)) return;
    let decoded;
    try {
        decoded = decodeURIComponent(target);
    } catch {
        return `${source}: malformed local link: ${target}`;
    }
    const [pathAndQuery, anchor] = decoded.split('#');
    const path = pathAndQuery.split('?')[0];
    const absolute = path
        ? resolve(literal ? rootDir : dirname(resolve(rootDir, source)), path)
        : resolve(rootDir, source);
    if (!within(rootDir, absolute))
        return `${source}: referenced path escapes repository root: ${target}`;
    try {
        const actual = await realpath(absolute);
        if (!within(rootDir, actual))
            return `${source}: referenced path escapes repository root: ${target}`;
        if (anchor && !anchors(await readFile(actual, 'utf8')).has(anchor)) {
            return `${source}: missing anchor "${anchor}" in ${target}`;
        }
    } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code))
            return `${source}: referenced path does not exist: ${target}`;
        if (error.code === 'EISDIR')
            return `${source}: anchor target is a directory: ${target}`;
        throw error;
    }
}

export async function validateAgentGuidance({ rootDir }) {
    rootDir = await realpath(rootDir);
    const diagnostics = [];
    for (const source of SURFACES) {
        let markdown;
        try {
            markdown = await readFile(resolve(rootDir, source), 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            diagnostics.push(`${source}: required guidance file is missing`);
            continue;
        }
        if (LIMITS[source]) {
            const [maxLines, maxBytes] = LIMITS[source];
            const lines =
                markdown === ''
                    ? 0
                    : markdown.replace(/\r?\n$/u, '').split(/\r?\n/u).length;
            const bytes = Buffer.byteLength(markdown, 'utf8');
            if (lines > maxLines)
                diagnostics.push(
                    `${source}: at most ${maxLines} lines allowed (received ${lines})`
                );
            if (bytes > maxBytes)
                diagnostics.push(
                    `${source}: at most ${maxBytes} UTF-8 bytes allowed (received ${bytes})`
                );
            const imports = [...markdown.matchAll(/^\s*@([^\s]+)\s*$/gmu)].map(
                (match) => match[1]
            );
            const prose = withoutFences(markdown).replace(/`[^`\n]+`/gu, '');
            const inlineImports = [...prose.matchAll(/(?:^|[\s(])@([^\s]+)/gu)]
                .map((match) => match[1])
                .filter(
                    (token) =>
                        !token.startsWith('iptvnator/') &&
                        (/[./\\]/u.test(token) ||
                            /^(?:LICENSE|Makefile|Dockerfile|AGENTS|CLAUDE)(?:$|[.,;)])/u.test(
                                token
                            ))
                );
            if (
                inlineImports.some((token) => token !== 'AGENTS.md') ||
                (source === 'AGENTS.md' && inlineImports.length) ||
                (source === 'CLAUDE.md' &&
                    inlineImports.filter((token) => token === 'AGENTS.md')
                        .length !== 1)
            ) {
                diagnostics.push(
                    `${source}: additional or inline guidance imports are not allowed`
                );
            }
            if (source === 'CLAUDE.md') {
                if (imports.length !== 1 || imports[0] !== 'AGENTS.md')
                    diagnostics.push(
                        `${source}: exactly one standalone @AGENTS.md import is required; no other imports are allowed`
                    );
            } else if (imports.length)
                diagnostics.push(`${source}: imports are not allowed`);
        }
        for (const reference of references(
            markdown,
            !source.endsWith('agent-guidance-migration.md')
        )) {
            const diagnostic = await validateReference(
                rootDir,
                source,
                reference
            );
            if (diagnostic) diagnostics.push(diagnostic);
        }
    }
    return { checkedFiles: SURFACES.length, diagnostics };
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const { checkedFiles, diagnostics } = await validateAgentGuidance({
        rootDir: process.cwd(),
    });
    if (diagnostics.length) {
        for (const diagnostic of diagnostics) console.error(diagnostic);
        process.exitCode = 1;
    } else console.log(`Validated ${checkedFiles} agent guidance files.`);
}
