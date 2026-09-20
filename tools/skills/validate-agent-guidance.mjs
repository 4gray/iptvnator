import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    guidanceAnchors as anchors,
    guidanceProse,
    guidanceReferences as references,
} from './agent-guidance-markdown.mjs';

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

async function validateReference(
    rootDir,
    source,
    { target, literal, unresolvedReference }
) {
    if (unresolvedReference !== undefined)
        return `${source}: unresolved Markdown reference "${unresolvedReference}"`;
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(target)) return;
    let path;
    let anchor;
    try {
        const hash = target.indexOf('#');
        const pathAndQuery = hash < 0 ? target : target.slice(0, hash);
        path = decodeURIComponent(pathAndQuery.split('?')[0]);
        anchor =
            hash < 0 ? undefined : decodeURIComponent(target.slice(hash + 1));
    } catch {
        return `${source}: malformed local link: ${target}`;
    }
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
            const unfenced = guidanceProse(markdown);
            const imports = [...unfenced.matchAll(/^\s*@([^\s]+)\s*$/gmu)].map(
                (match) => match[1]
            );
            const prose = unfenced.replace(/`[^`\n]+`/gu, '');
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
