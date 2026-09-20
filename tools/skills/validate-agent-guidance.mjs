import ts from 'typescript';
import { readFile, realpath, stat } from 'node:fs/promises';
import {
    dirname,
    extname,
    isAbsolute,
    relative,
    resolve,
    sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    guidanceAnchors as anchors,
    guidanceProse,
    guidanceStandaloneImports,
    guidanceReferences as references,
} from './agent-guidance-markdown.mjs';

const MARKDOWN_EXTENSION = /\.(?:md|markdown|mdown|mkd|mdx)$/iu;

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
    { target, literal, image, unresolvedReference }
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
        if (
            anchor &&
            !image &&
            MARKDOWN_EXTENSION.test(extname(actual)) &&
            !anchors(await readFile(actual, 'utf8')).has(anchor)
        ) {
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

async function packageMentions(rootDir) {
    async function readJson(path) {
        try {
            const text = await readFile(resolve(rootDir, path), 'utf8');
            if (path !== 'tsconfig.base.json') return JSON.parse(text);
            const parsed = ts.parseConfigFileTextToJson(path, text);
            if (parsed.error)
                throw new Error(
                    ts.flattenDiagnosticMessageText(
                        parsed.error.messageText,
                        '\n'
                    )
                );
            return parsed.config;
        } catch (error) {
            if (error.code === 'ENOENT') return {};
            throw error;
        }
    }
    const manifest = await readJson('package.json');
    const config = await readJson('tsconfig.base.json');
    const packages = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
    ];
    const names = [
        ...packages,
        ...Object.keys(config.compilerOptions?.paths ?? {}),
    ];
    const declared = names
        .filter((name) => /^@[^/]+\//u.test(name))
        .map((name) => name.slice(1));
    const scopes = new Set(declared.map((name) => name.split('/')[0]));
    return (raw) => {
        // ASCII punctuation also belongs to package names and version ranges.
        let token = raw.split(/[,;:!?]|(?=[^\x00-\x7f])\p{P}/u, 1)[0];
        token = token.replace(/[?!.,;:)"'\]}]+$/u, '');
        token = token.replace(/['’]s$/iu, '');
        token = token.replace(
            /^([^/@]+(?:\/[^/@]+)?)@(?:(?:[~^]|[<>]=?|=)?\d[\w.*+-]*|\*|[a-z][\w-]*)$/iu,
            '$1'
        );
        if (
            token.split(/[\/\\]/u).some((part) => part === '.' || part === '..')
        )
            return false;
        const path = token.split(/[?#]/u, 1)[0];
        if (
            /%[\da-f]{2}/iu.test(token) ||
            MARKDOWN_EXTENSION.test(path) ||
            /\.(?:txt|json|ya?ml|html?|rst|rest|adoc|asciidoc)$/iu.test(path)
        )
            return false;
        if (packages.includes(token)) return true;
        if (token.endsWith('/*') && scopes.has(token.slice(0, -2))) return true;
        return declared.some((name) => {
            const star = name.indexOf('*');
            return star < 0
                ? token === name ||
                      (packages.includes(`@${name}`) &&
                          token.startsWith(`${name}/`))
                : token.startsWith(name.slice(0, star)) &&
                      token.endsWith(name.slice(star + 1));
        });
    };
}

export async function validateAgentGuidance({ rootDir }) {
    rootDir = await realpath(rootDir);
    const diagnostics = [];
    const isPackageMention = await packageMentions(rootDir);
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
                    : markdown
                          .replace(/(?:\r\n|[\r\n])$/u, '')
                          .split(/\r\n|[\r\n]/u).length;
            const bytes = Buffer.byteLength(markdown, 'utf8');
            if (lines > maxLines)
                diagnostics.push(
                    `${source}: at most ${maxLines} lines allowed (received ${lines})`
                );
            if (bytes > maxBytes)
                diagnostics.push(
                    `${source}: at most ${maxBytes} UTF-8 bytes allowed (received ${bytes})`
                );
            const prose = guidanceProse(markdown);
            const imports = guidanceStandaloneImports(markdown);
            const inlineImports = [];
            for (const match of prose.matchAll(
                /(?:^|[^\p{L}\p{N}_@])@([^\s]+)/gu
            )) {
                const token = match[1];
                if (isPackageMention(token)) continue;
                if (
                    /[./\\]/u.test(token) ||
                    /^(?:LICENSE|Makefile|Dockerfile|AGENTS|CLAUDE)(?:$|[.,;)])/u.test(
                        token
                    )
                ) {
                    inlineImports.push(token);
                    continue;
                }
                // Check real filenames before interpreting punctuation as prose.
                const candidates = new Set([
                    token,
                    token.replace(/[?!.,;:)"'\]}]+$/u, ''),
                ]);
                for (const boundary of token.matchAll(
                    /[,;:!?]|(?=[^\x00-\x7f])\p{P}/gu
                ))
                    candidates.add(token.slice(0, boundary.index));
                for (const candidate of candidates) {
                    try {
                        if (
                            (await stat(resolve(rootDir, candidate))).isFile()
                        ) {
                            inlineImports.push(token);
                            break;
                        }
                    } catch (error) {
                        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
                            throw error;
                    }
                }
            }
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
