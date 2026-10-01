import path from 'node:path';

/** The files a relative Sass load can name, in Sass's resolution order. */
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

function reach(start, edges) {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
        for (const next of edges.get(stack.pop()) ?? []) {
            if (seen.has(next)) continue;
            seen.add(next);
            stack.push(next);
        }
    }
    return seen;
}

/**
 * Where a Sass variable used in a file can be defined. Sass modules are
 * scoped, so a use sees its own file, the files it loads (`@use`, `@forward`,
 * `@import`, transitively) and the files that load it, which pass mixin
 * arguments and `with (…)` configuration. Two files that only share a partial
 * are not connected, so a `$local` in one never stands for the other's.
 *
 * `scans` carry `file` and `imports` (relative load specifiers).
 */
export function sassScopes(scans) {
    const known = new Set(scans.map((scan) => scan.file));
    const loads = new Map();
    const loadedBy = new Map();
    for (const { file, imports = [] } of scans) {
        const targets = imports
            .map((specifier) =>
                candidates(file, specifier).find((c) => known.has(c))
            )
            .filter(Boolean);
        loads.set(file, targets);
        for (const target of targets) {
            if (!loadedBy.has(target)) loadedBy.set(target, []);
            loadedBy.get(target).push(file);
        }
    }
    const cache = new Map();
    return (file) => {
        if (!cache.has(file)) {
            const scope = new Set([
                ...reach(file, loads),
                ...reach(file, loadedBy),
            ]);
            cache.set(file, scope);
        }
        return cache.get(file);
    };
}
