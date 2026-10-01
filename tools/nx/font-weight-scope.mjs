import path from 'node:path';

const BOTH = { declarations: true, arguments: true };
const DECLARATIONS = { declarations: true, arguments: false };

/**
 * The files a Sass load can name, in Sass's resolution order. Bare targets
 * (`@use 'tokens'`) resolve next to the loading file first; package and
 * built-in modules (`@angular/material`, `sass:math`) are not workspace files
 * and simply match nothing.
 */
function candidates(from, specifier) {
    const target = path.posix.join(path.posix.dirname(from), specifier);
    const dir = path.posix.dirname(target);
    const base = path.posix.basename(target);
    return [
        target,
        `${target}.scss`,
        `${dir}/_${base}.scss`,
        `${target}/_index.scss`,
        `${target}/index.scss`,
    ];
}

/** `@use '../x/_tokens'` is namespaced `tokens` unless `as` renames it. */
function namespaceOf({ target, as }) {
    if (as) return as;
    return path.posix
        .basename(target)
        .replace(/\.s?css$/, '')
        .replace(/^_/, '');
}

function push(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
}

function merge(scope, file, access) {
    const known = scope.get(file) ?? { declarations: false, arguments: false };
    scope.set(file, {
        declarations: known.declarations || access.declarations,
        arguments: known.arguments || access.arguments,
    });
}

/**
 * Which definitions a Sass variable can resolve to, following the module
 * system. `declarations` are `$x: 1;` statements; `arguments` are `$x: 1`
 * inside a mixin call or a `with (…)` configuration.
 *
 * `qualified(file, ns)` — `ns.$x`: the members of the module the file loads
 * as `ns` (its declarations and, transitively, what it `@forward`s), plus the
 * arguments written inside that `@use`'s own `with (…)` (or a `@forward …
 * with (…)` in the chain), by position, so a same-named argument elsewhere,
 * or another module's configuration, never counts. Returned per file as
 * `{ declarations, ranges }`.
 *
 * `unqualified(file)` — `$x`, per file:
 * - the file itself: both;
 * - members of modules it loads `as *`, and files it `@import`s (textual
 *   inclusion, transitively): their declarations;
 * - files that load it: only the arguments they pass, since `@use` never
 *   injects the loader's own variables. A chain of `@import`s is textual,
 *   so there the loader's declarations count too.
 *
 * A namespaced `@use` adds nothing unqualified, and two files that only share
 * a partial are never connected. Not traced: `@forward … as prefix-*`.
 * `scans` carry `file` and `loads` (`{ rule, target, as, configuration }`).
 */
export function sassScopes(scans) {
    const known = new Set(scans.map((scan) => scan.file));
    const edges = new Map();
    const loadedBy = new Map();
    for (const { file, loads = [] } of scans) {
        for (const load of loads) {
            const loaded = candidates(file, load.target).find((c) =>
                known.has(c)
            );
            if (!loaded) continue;
            const namespace = load.rule === 'use' ? namespaceOf(load) : null;
            const ranges = load.configuration ? [load.configuration] : [];
            push(edges, file, { rule: load.rule, loaded, namespace, ranges });
            push(loadedBy, loaded, { file, textual: load.rule === 'import' });
        }
    }

    // A module's members, each with where a forwarding `with (…)` sits.
    const membersCache = new Map();
    const members = (module) => {
        if (membersCache.has(module)) return membersCache.get(module);
        const found = new Map([[module, []]]);
        membersCache.set(module, found);
        const stack = [module];
        while (stack.length > 0) {
            const current = stack.pop();
            for (const edge of edges.get(current) ?? []) {
                if (edge.rule !== 'forward') continue;
                found.get(current).push(...edge.ranges);
                if (found.has(edge.loaded)) continue;
                found.set(edge.loaded, []);
                stack.push(edge.loaded);
            }
        }
        return found;
    };

    const qualified = (file, namespace) => {
        const scope = new Map();
        const add = (target, declarations, ranges) => {
            const known = scope.get(target) ?? {
                declarations: false,
                ranges: [],
            };
            known.ranges.push(...ranges);
            known.declarations ||= declarations;
            scope.set(target, known);
        };
        for (const edge of edges.get(file) ?? []) {
            if (edge.rule !== 'use' || edge.namespace !== namespace) continue;
            add(file, false, edge.ranges);
            for (const [member, ranges] of members(edge.loaded)) {
                add(member, true, ranges);
            }
        }
        return scope;
    };

    const cache = new Map();
    const unqualified = (file) => {
        if (cache.has(file)) return cache.get(file);
        const scope = new Map([[file, BOTH]]);
        const down = [file];
        const imported = new Set(down);
        while (down.length > 0) {
            for (const edge of edges.get(down.pop()) ?? []) {
                if (edge.rule === 'use' && edge.namespace === '*') {
                    for (const member of members(edge.loaded).keys()) {
                        merge(scope, member, DECLARATIONS);
                    }
                } else if (edge.rule === 'import') {
                    merge(scope, edge.loaded, DECLARATIONS);
                    if (!imported.has(edge.loaded)) {
                        imported.add(edge.loaded);
                        down.push(edge.loaded);
                    }
                }
            }
        }
        const up = [{ file, textual: true }];
        const visitedUp = new Set([`${file} true`]);
        while (up.length > 0) {
            const current = up.pop();
            for (const loader of loadedBy.get(current.file) ?? []) {
                const textual = current.textual && loader.textual;
                merge(scope, loader.file, {
                    declarations: textual,
                    arguments: true,
                });
                const key = `${loader.file} ${textual}`;
                if (!visitedUp.has(key)) {
                    visitedUp.add(key);
                    up.push({ file: loader.file, textual });
                }
            }
        }
        cache.set(file, scope);
        return scope;
    };

    return { qualified, unqualified };
}
