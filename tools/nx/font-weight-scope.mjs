import path from 'node:path';

const BOTH = Object.freeze({ declarations: true, arguments: true, ranges: [] });
const DECLARATIONS = Object.freeze({
    declarations: true,
    arguments: false,
    ranges: [],
});

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
    const known = scope.get(file) ?? {
        declarations: false,
        arguments: false,
        ranges: [],
    };
    scope.set(file, {
        declarations: known.declarations || access.declarations,
        arguments: known.arguments || access.arguments,
        ranges: [...known.ranges, ...(access.ranges ?? [])],
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
 * - files that load it: only what they pass in, since `@use` never injects
 *   the loader's own variables. That is the `with (…)` configuration of the
 *   load (as `ranges`) and arguments, which the caller then matches to the
 *   callable they are passed to. A chain of `@import`s is textual, so there
 *   the loader's declarations count too.
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
            push(edges, file, {
                ...{ rule: load.rule, loaded, namespace, ranges },
                index: load.index,
            });
            push(loadedBy, loaded, {
                file,
                textual: load.rule === 'import',
                ranges,
            });
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
            const current = down.pop();
            for (const edge of edges.get(current) ?? []) {
                if (edge.rule === 'use' && edge.namespace === '*') {
                    // Its `with (…)` configures what the loading file reads.
                    merge(scope, current, { ...BOTH, ranges: edge.ranges });
                    for (const [member, ranges] of members(edge.loaded)) {
                        merge(scope, member, {
                            ...DECLARATIONS,
                            arguments: ranges.length > 0,
                            ranges,
                        });
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
                    ranges: loader.ranges,
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

    /** Files `@import`ed by `file`, with where each `@import` sits. */
    const imports = (file) =>
        (edges.get(file) ?? [])
            .filter((edge) => edge.rule === 'import')
            .map(({ loaded, index }) => ({ loaded, index }));

    return { qualified, unqualified, imports };
}

/**
 * The declarations of one name in the reference's own file that can be in
 * effect at the reference, as Sass runs them. Scopes are tried innermost
 * first; in the first that declares the name before the reference, the last
 * unconditional assignment counts, plus any conditional (flow-control) ones
 * after it, and an inner declaration shadows outer ones. A scope with only
 * conditional assignments falls through to the next. Inside a `@mixin` or
 * `@function` body, module variables are read at call time: the top level is
 * resolved at each call site in the file (`callSites`) and at the end of the
 * module, for callers elsewhere. `settled` means an unconditional
 * declaration decided the value.
 */
export function effectiveDeclarations(reference, candidates, callSites = []) {
    const picked = new Set();
    const inEffect = (here) => {
        const firm = here.map((d) => !d.conditional).lastIndexOf(true);
        for (const d of firm === -1 ? here : here.slice(firm)) picked.add(d);
        return firm !== -1;
    };
    const at = (scope, position) =>
        candidates
            .filter((d) => d.scope === scope && d.index < position)
            .sort((a, b) => a.index - b.index);
    for (const scope of reference.scopes) {
        if (scope === null && reference.inCallable) {
            const positions = [...callSites, Infinity];
            const settled = positions
                .map((position) => inEffect(at(null, position)))
                .every(Boolean);
            return { picked: [...picked], settled };
        }
        const here = at(scope, reference.index);
        if (here.length > 0 && inEffect(here)) {
            return { picked: [...picked], settled: true };
        }
    }
    return { picked: [...picked], settled: false };
}
