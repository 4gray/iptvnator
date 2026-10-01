import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLESHEET_RULE = /@(use|forward|import)\s+([^;{}]*)/g;
const QUOTED_TARGET = /(['"])([^'"]+)\1/g;
const CSS_URL = /url\([^)]*\)/g;

/**
 * `@import` is the only rule that accepts a comma-separated list, and every
 * entry in it is a separate dependency: reading just the first would let a
 * later cross-project target escape the cache key while the check still
 * passes. `@use`/`@forward` load exactly one module, so a quoted string after
 * the first belongs to a `with (...)` configuration and is a value, not a
 * dependency. `url(...)` is a plain CSS import the browser resolves at
 * runtime, so Sass never compiles it and it is not a build input either.
 */
function targetsOfRule(rule, clause) {
    const quoted = [
        ...clause.replace(CSS_URL, ' ').matchAll(QUOTED_TARGET),
    ].map((match) => match[2]);
    return rule === 'import' ? quoted : quoted.slice(0, 1);
}

/**
 * Sass documents relative `@use` examples inside comments. Those paths do not
 * resolve from the file that documents them, so scanning raw source reports
 * them as broken imports.
 */
export function stripScssComments(source) {
    // Blank rather than cut, so every offset still points into `source`.
    const blank = (text) => text.replace(/[^\n]/g, ' ');
    const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, blank);
    return withoutBlocks
        .split('\n')
        .map((line) => {
            const commentStart = line.search(/(^|[^:])\/\//);
            if (commentStart === -1) return line;
            const cut =
                line[commentStart] === '/' ? commentStart : commentStart + 1;
            return line.slice(0, cut) + blank(line.slice(cut));
        })
        .join('\n');
}

/**
 * Every `@use`/`@forward`/`@import` target, with the rule that loads it, any
 * `as` clause (`as t`, `as *`, or a `@forward … as btn-*` prefix), where the
 * rule starts (`index`) and where its `with (…)` configuration sits in
 * `source` (`[start, end)`, or `null`).
 */
export function extractStylesheetLoads(source) {
    const loads = [];
    const stripped = stripScssComments(source);
    for (const match of stripped.matchAll(STYLESHEET_RULE)) {
        const [whole, rule, clause] = match;
        const clauseStart = match.index + whole.length - clause.length;
        const rest = clause.replace(QUOTED_TARGET, (quoted) =>
            ' '.repeat(quoted.length)
        );
        const as =
            rule === 'import'
                ? null
                : (/\bas\s+(\*|[\w-]+\*?)/.exec(rest)?.[1] ?? null);
        const opening = /\bwith\s*\(/.exec(rest);
        const configuration = opening
            ? [
                  clauseStart + opening.index + opening[0].length,
                  clauseStart + rest.lastIndexOf(')'),
              ]
            : null;
        for (const target of targetsOfRule(rule, clause)) {
            loads.push({ rule, target, as, configuration, index: match.index });
        }
    }
    return loads;
}

export function extractRelativeImports(source) {
    return extractStylesheetLoads(source)
        .map(({ target }) => target)
        .filter((target) => target.startsWith('.'));
}

/** Mirrors Sass partial resolution for a relative specifier. */
export function resolveStylesheet(
    fromFile,
    specifier,
    fileExists = (candidate) => existsSync(candidate)
) {
    const target = path.resolve(path.dirname(fromFile), specifier);
    const dir = path.dirname(target);
    const base = path.basename(target);
    const candidates = [
        target,
        `${target}.scss`,
        path.join(dir, `_${base}.scss`),
        path.join(target, '_index.scss'),
        path.join(target, 'index.scss'),
    ];
    return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

function closureOf(graph, start) {
    const reachable = new Set();
    const stack = [start];
    while (stack.length > 0) {
        const current = stack.pop();
        if (reachable.has(current)) continue;
        reachable.add(current);
        for (const dependency of graph.dependencies[current] ?? []) {
            stack.push(dependency.target);
        }
    }
    return reachable;
}

/**
 * A stylesheet only participates in a build's cache key when its owning project
 * is inside that build's input closure. A cross-project import that escapes the
 * closure is served from a stale cache instead of being recompiled.
 */
export function validateStylesheetInputs({ imports, graph }) {
    const diagnostics = [];
    const buildClosures = Object.entries(graph.nodes)
        .filter(([, node]) => node.data?.targets?.build)
        .map(([name]) => [name, closureOf(graph, name)]);

    for (const entry of imports) {
        if (!entry.sourceProject) {
            diagnostics.push(
                `${entry.sourceFile} belongs to no Nx project, so its contents are outside every task hash. Give the directory a project.json.`
            );
            continue;
        }
        if (entry.sourceProject === entry.targetProject) continue;

        if (!entry.targetProject) {
            diagnostics.push(
                `${entry.sourceFile} imports "${entry.specifier}" (${entry.targetFile}), which belongs to no Nx project. Give that directory a project.json so edits invalidate dependent builds.`
            );
            continue;
        }

        for (const [buildProject, closure] of buildClosures) {
            if (!closure.has(entry.sourceProject)) continue;
            if (closure.has(entry.targetProject)) continue;
            diagnostics.push(
                `${buildProject}:build compiles ${entry.sourceFile}, which imports ${entry.targetFile} from project "${entry.targetProject}" — a project outside that build's input closure, so edits to it are served from a stale cache. Add "implicitDependencies": ["${entry.targetProject}"] to the "${entry.sourceProject}" project.`
            );
        }
    }

    return diagnostics;
}

/**
 * A check that scanned nothing must never report success. The workspace always
 * contains stylesheets, so an empty listing means the scan broke — the failure
 * mode a shell-quoted pathspec produced on Windows, where `git` received the
 * quote characters literally, matched no files and still exited 0.
 */
export function validateScanCoverage(files) {
    if (files.length > 0) return [];
    return [
        'No stylesheets were scanned. The workspace always contains SCSS, so an empty listing means the file scan failed rather than that the policy passed.',
    ];
}

function ownerOf(projectRoots, absoluteFile) {
    let owner = null;
    for (const [name, root] of projectRoots) {
        const prefix = `${root}${path.sep}`;
        if (absoluteFile === root || absoluteFile.startsWith(prefix)) {
            if (!owner || root.length > owner.root.length)
                owner = { name, root };
        }
    }
    return owner?.name ?? null;
}

export async function collectStylesheetImports({ rootDir, files, graph }) {
    const projectRoots = Object.entries(graph.nodes).map(([name, node]) => [
        name,
        path.resolve(rootDir, node.data.root),
    ]);
    const imports = [];

    for (const file of files) {
        const absolute = path.resolve(rootDir, file);
        const source = await readFile(absolute, 'utf8');
        for (const specifier of extractRelativeImports(source)) {
            const resolved = resolveStylesheet(absolute, specifier);
            if (!resolved) {
                imports.push({
                    sourceFile: file,
                    specifier,
                    targetFile: '(unresolved)',
                    sourceProject: ownerOf(projectRoots, absolute),
                    targetProject: null,
                });
                continue;
            }
            imports.push({
                sourceFile: file,
                specifier,
                targetFile: path.relative(rootDir, resolved),
                sourceProject: ownerOf(projectRoots, absolute),
                targetProject: ownerOf(projectRoots, resolved),
            });
        }
    }

    return imports;
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const { createProjectGraphAsync } = await import('@nx/devkit');

    const graph = await createProjectGraphAsync({ exitOnError: true });
    // No shell: `cmd.exe` treats single quotes as literal characters, so a
    // POSIX-quoted pathspec reaches git intact on Windows and matches nothing.
    const files = execFileSync('git', ['ls-files', '*.scss'], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
        .trim()
        .split('\n')
        .filter(Boolean);

    const imports = await collectStylesheetImports({ rootDir, files, graph });
    const diagnostics = [
        ...validateScanCoverage(files),
        ...validateStylesheetInputs({ imports, graph }),
    ];

    if (diagnostics.length > 0) {
        console.error('Stylesheet Nx input policy failed:');
        for (const diagnostic of diagnostics) console.error(`- ${diagnostic}`);
        process.exitCode = 1;
    } else {
        console.log(
            `Checked ${imports.length} relative stylesheet imports across ${files.length} files; every imported stylesheet is inside its consuming build's input closure.`
        );
    }
}
