/**
 * Lists repository files outside a Tier A project that its code refers to by
 * path: relative module specifiers and path strings such as
 * `'../../../../../.github/workflows/build-and-make.yaml'` or
 * `'tools/embedded-mpv/stage-runtime.mjs'`. The unit-coverage scope rule must
 * never treat these as skippable; unit-coverage-scope.test.mjs asserts that.
 *
 * String literals are read from the TypeScript AST, so paths mentioned in
 * comments do not count. Imports of other apps/libs code are project-graph
 * edges and are left to Nx; node_modules is ignored.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SOURCE_FILE = /\.(ts|mts|cts|js|mjs|cjs)$/;
const WORKSPACE_PATH = /^(?:\.github|tools|docs|patches|scripts|snap|resources|build)\/|^[\w.-]+\.(?:json|ya?ml|md|js|cjs|mjs)$/;

function listSources(directory, out = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) listSources(fullPath, out);
        else if (SOURCE_FILE.test(entry.name)) out.push(fullPath);
    }
    return out;
}

function stringLiterals(fileName, text) {
    const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
    const literals = [];
    const visit = (node) => {
        if (ts.isStringLiteralLike(node)) literals.push(node.text);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return literals;
}

function isOtherProjectCode(relative) {
    return /^(apps|libs)\//.test(relative) && !/\.(json|ya?ml|md)$/.test(relative);
}

/** Returns Map<workspace-relative file, Set<referencing file>>. */
export function tierAExternalReferences({ workspaceRoot, tierAProjects }) {
    const references = new Map();
    const record = (target, from) => {
        if (!references.has(target)) references.set(target, new Set());
        references.get(target).add(path.relative(workspaceRoot, from));
    };
    for (const project of tierAProjects) {
        const projectRoot = path.resolve(workspaceRoot, project.root);
        for (const file of listSources(path.resolve(workspaceRoot, project.sourceRoot))) {
            for (const literal of stringLiterals(file, readFileSync(file, 'utf8'))) {
                let absolute = null;
                if (literal.startsWith('../')) {
                    absolute = path.resolve(path.dirname(file), literal);
                } else if (WORKSPACE_PATH.test(literal)) {
                    absolute = path.resolve(workspaceRoot, literal);
                }
                if (!absolute || !existsSync(absolute)) continue;
                const relative = path.relative(workspaceRoot, absolute);
                if (relative.startsWith('..') || relative.startsWith('node_modules')) continue;
                if (absolute === projectRoot || absolute.startsWith(projectRoot + path.sep)) continue;
                if (isOtherProjectCode(relative)) continue;
                record(relative.split(path.sep).join('/'), file);
            }
        }
    }
    return references;
}
