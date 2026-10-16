import path from 'node:path';

/** How a module reads its own members: unprefixed, nothing hidden. */
const DIRECT = Object.freeze({ prefix: '', filters: Object.freeze([]) });

const BOTH = Object.freeze({
    declarations: true,
    arguments: true,
    ranges: [],
    before: Infinity,
    exposures: [DIRECT],
});
const DECLARATIONS = Object.freeze({ ...BOTH, arguments: false });
const NOTHING = Object.freeze({
    ...BOTH,
    declarations: false,
    arguments: false,
    exposures: [],
});

/** Sass reads `-` and `_` in a name as the same character. */
export function sassName(name) {
    return name.replace(/_/g, '-');
}

/** `$w` (or a mixin or function `m`) with `prefix` after its `$`. */
function prefixed(prefix, name) {
    return sassName(
        name.startsWith('$') ? `$${prefix}${name.slice(1)}` : prefix + name
    );
}

/**
 * The name a loader reads a member `name` by through `exposure`: under its
 * prefix, or `null` where a `show`/`hide` on the way leaves it out.
 */
export function exposedName({ prefix, filters }, name) {
    const exposed = prefixed(prefix, name);
    const kept = filters.every(
        ({ kind, names }) => names.has(exposed) === (kind === 'show')
    );
    return kept ? exposed : null;
}

const keyOf = ({ prefix, filters }) =>
    [prefix, ...filters.map((filter) => filter.key)].join(' ');

/**
 * A forwarding cycle with prefixes would grow without end; without them, a
 * list already on the way is not added again, so the cycle repeats a key.
 */
const tooLong = ({ prefix }) => prefix.length > 200;

/**
 * One more `@forward` below `exposure`: its `as p-*` prefix goes after the
 * ones above, and its `show`/`hide` names, written as that `@forward`
 * exposes them, read under the prefixes above.
 */
function deeper(exposure, { prefix, filter }) {
    const filters = [...exposure.filters];
    if (filter) {
        const names = new Set(
            filter.names.map((name) => prefixed(exposure.prefix, name))
        );
        const key = `${filter.kind}:${[...names].sort().join(',')}`;
        if (!filters.some((known) => known.key === key)) {
            filters.push({ kind: filter.kind, names, key });
        }
    }
    return { prefix: exposure.prefix + prefix, filters };
}

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
        ...NOTHING,
        ranges: [],
        before: -Infinity,
    };
    const exposures = new Map(
        [...known.exposures, ...access.exposures].map((e) => [keyOf(e), e])
    );
    scope.set(file, {
        declarations: known.declarations || access.declarations,
        arguments: known.arguments || access.arguments,
        ranges: [...known.ranges, ...access.ranges],
        // A file can count only up to a position (an `@import` of it).
        before: Math.max(known.before, access.before),
        exposures: [...exposures.values()],
    });
}

/** `with (…)` ranges whose names read as `exposure` turns them. */
const rangesOf = (ranges, exposure, outward = false) =>
    ranges.map(([start, end]) => ({ start, end, exposure, outward }));

/**
 * Which definitions a Sass variable can resolve to, following the module
 * system. `declarations` are `$x: 1;` statements; `arguments` are `$x: 1`
 * inside a mixin call or a `with (…)` configuration.
 *
 * `qualified(file, ns)` — `ns.$x`: the members of the module the file loads
 * as `ns` (its declarations and, transitively, what it `@forward`s), plus the
 * arguments written inside that `@use`'s own `with (…)` (or a `@forward …
 * with (…)` in the chain), by position, so a same-named argument elsewhere,
 * or another module's configuration, never counts.
 *
 * `unqualified(file)` — `$x`, per file:
 * - the file itself: both;
 * - members of modules it loads `as *`, and files it `@import`s (textual
 *   inclusion, transitively) with what they `@forward`: their declarations;
 * - files that load it: only what they pass in, since `@use` never injects
 *   the loader's own variables. That is the `with (…)` configuration of the
 *   load and arguments, which the caller then matches to the callable they
 *   are passed to. A chain of `@import`s is textual, so there the loader's
 *   declarations count too.
 *
 * A namespaced `@use` adds nothing unqualified, and two files that only share
 * a partial are never connected. Each file carries the `exposures` it is read
 * through (see `exposedName`): a `@forward … as p-*` chain prefixes members,
 * and its `show`/`hide` lists leave some out. Each `with (…)` range carries
 * the exposure that turns the names written in it into the names read
 * (`outward` when the reader is the configured module, read before the
 * prefix). Sass lets a loader configure a hidden member, so only prefixes
 * apply there. A textual importer counts only `before` its `@import`.
 * `scans` carry `file` and `loads` (`{ rule, target, as, configuration,
 * filter }`).
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
            const forward = load.rule === 'forward';
            // `@forward 'x' as btn-*` exposes `$v` as `$btn-v`.
            const prefix =
                forward && load.as?.endsWith('*') ? load.as.slice(0, -1) : '';
            const filter = forward ? load.filter : null;
            push(edges, file, {
                ...{ rule: load.rule, loaded, namespace, ranges, prefix },
                ...{ filter, index: load.index },
            });
            push(loadedBy, loaded, {
                ...{ file, textual: load.rule === 'import', ranges, prefix },
                forward,
                index: load.index,
            });
        }
    }

    // A module's members: how each file is exposed, and where a forwarding
    // `with (…)` sits.
    const membersCache = new Map();
    const members = (module) => {
        if (membersCache.has(module)) return membersCache.get(module);
        const found = new Map();
        const reach = (file, exposure) => {
            if (!found.has(file))
                found.set(file, { ranges: [], exposures: [] });
            const { exposures } = found.get(file);
            if (!exposures.some((e) => keyOf(e) === keyOf(exposure))) {
                exposures.push(exposure);
            }
        };
        reach(module, DIRECT);
        membersCache.set(module, found);
        const stack = [{ file: module, exposure: DIRECT }];
        const seen = new Set([`${module} ${keyOf(DIRECT)}`]);
        while (stack.length > 0) {
            const { file: current, exposure } = stack.pop();
            for (const edge of edges.get(current) ?? []) {
                if (edge.rule !== 'forward') continue;
                const next = deeper(exposure, edge);
                // Its `with (…)` names the forwarded module's own members,
                // which a reader of this module sees through `next`.
                found.get(current).ranges.push(...rangesOf(edge.ranges, next));
                reach(edge.loaded, next);
                const key = `${edge.loaded} ${keyOf(next)}`;
                if (seen.has(key) || tooLong(next)) continue;
                seen.add(key);
                stack.push({ file: edge.loaded, exposure: next });
            }
        }
        return found;
    };
    const bringIn = (scope, module) => {
        for (const [member, { ranges, exposures }] of members(module)) {
            merge(scope, member, {
                ...DECLARATIONS,
                arguments: ranges.length > 0,
                ...{ ranges, exposures },
            });
        }
    };

    const qualified = (file, namespace) => {
        const scope = new Map();
        for (const edge of edges.get(file) ?? []) {
            if (edge.rule !== 'use' || edge.namespace !== namespace) continue;
            merge(scope, file, {
                ...NOTHING,
                ranges: rangesOf(edge.ranges, DIRECT),
            });
            for (const [member, { ranges, exposures }] of members(
                edge.loaded
            )) {
                merge(scope, member, { ...DECLARATIONS, ranges, exposures });
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
                    merge(scope, current, {
                        ...BOTH,
                        ranges: rangesOf(edge.ranges, DIRECT),
                    });
                    bringIn(scope, edge.loaded);
                } else if (edge.rule === 'import') {
                    // An imported file's `@forward`s reach the importer too.
                    bringIn(scope, edge.loaded);
                    if (!imported.has(edge.loaded)) {
                        imported.add(edge.loaded);
                        down.push(edge.loaded);
                    }
                }
            }
        }
        // `exposure` turns this file's names into those the loader writes:
        // a loader of a `@forward … as p-*` configures `$w` as `$p-w`.
        const up = [{ file, textual: true, exposure: DIRECT }];
        const visitedUp = new Set([`${file} true ${keyOf(DIRECT)}`]);
        while (up.length > 0) {
            const current = up.pop();
            for (const loader of loadedBy.get(current.file) ?? []) {
                const textual = current.textual && loader.textual;
                // A textual importer's code before the `@import` has run when
                // the imported file's rules render; what follows has not.
                merge(scope, loader.file, {
                    ...{ declarations: textual, arguments: true },
                    ranges: rangesOf(loader.ranges, current.exposure, true),
                    before: textual ? loader.index : Infinity,
                    exposures: [DIRECT],
                });
                const exposure = {
                    prefix: loader.prefix + current.exposure.prefix,
                    filters: [],
                };
                const key = `${loader.file} ${textual} ${keyOf(exposure)}`;
                if (visitedUp.has(key) || tooLong(exposure)) continue;
                visitedUp.add(key);
                up.push({ file: loader.file, textual, exposure });
            }
        }
        cache.set(file, scope);
        return scope;
    };

    /**
     * The loads of `file`: who loads it, the `with (…)` ranges (`[start,
     * end)`) on each, and for a `@forward`, the prefix it adds.
     */
    const loadsOf = (file) => loadedBy.get(file) ?? [];

    /** Files `@import`ed by `file`, with where each `@import` sits. */
    const imports = (file) =>
        (edges.get(file) ?? [])
            .filter((edge) => edge.rule === 'import')
            .map(({ loaded, index }) => ({ loaded, index }));

    /**
     * Whether a call written in `caller` reaches `callable`, defined in
     * `file`: `ns.name` must load `file` (or a module forwarding it) as
     * `ns`, under the name it exposes `callable` by; a bare `name` is
     * defined in the caller itself or in what it brings in.
     */
    const reaches = ({ callee, file: caller }, file, callable) => {
        if (!callee || !callable) return false;
        if (!callee.namespace && caller === file) {
            return callee.name === callable;
        }
        const scope = callee.namespace
            ? qualified(caller, callee.namespace)
            : unqualified(caller);
        const access = scope.get(file);
        return (
            Boolean(access?.declarations) &&
            access.exposures.some(
                (exposure) => exposedName(exposure, callable) === callee.name
            )
        );
    };

    return { qualified, unqualified, imports, loadsOf, reaches };
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
 * module, for callers elsewhere. A `!default` assignment counts only where
 * no unconditional value precedes it, and never settles the value. Imported
 * declarations keep the text order of their inclusion. `settled` means an
 * unconditional declaration decided the value.
 */
export function effectiveDeclarations(reference, candidates, callSites = []) {
    const picked = new Set();
    // Text order; an imported declaration carries its path (`order`).
    const orderOf = (d) => d.order ?? [d.index];
    const compare = (a, b) => {
        const [x, y] = [orderOf(a), orderOf(b)];
        for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
            if (x[i] !== y[i]) return x[i] - y[i];
        }
        return x.length - y.length;
    };
    const firm = (d) => !d.conditional && !d.fallback;
    // `!default` assigns only while the name is unset, and `null` counts as
    // unset: the latest unconditional assignment before it, in its scope or
    // an outer one, wins unless it is `null`.
    const rank = new Map(reference.scopes.map((scope, i) => [scope, i]));
    const live = candidates.filter((d) => {
        if (!d.fallback) return true;
        const earlier = candidates
            .filter((f) => firm(f) && compare(f, d) < 0)
            .filter(
                (f) => (rank.get(f.scope) ?? -1) >= (rank.get(d.scope) ?? -1)
            )
            .sort(compare)
            .pop();
        return !earlier || /^null\b/i.test(earlier.value.trim());
    });
    const inEffect = (here) => {
        const last = here.map(firm).lastIndexOf(true);
        for (const d of last === -1 ? here : here.slice(last)) picked.add(d);
        return last !== -1;
    };
    const at = (scope, position) =>
        live
            .filter((d) => d.scope === scope && d.index < position)
            .sort(compare);
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
