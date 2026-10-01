import path from 'node:path';

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

function merge(scope, file, access) {
    const known = scope.get(file) ?? { declarations: false, arguments: false };
    scope.set(file, {
        declarations: known.declarations || access.declarations,
        arguments: known.arguments || access.arguments,
    });
}

/**
 * Which definitions a Sass variable used in a file can see, per file:
 * `declarations` (`$x: 1;` statements) and/or `arguments` (`$x: 1` inside a
 * mixin call or a `with (…)` configuration).
 *
 * - The file itself: both.
 * - Files it loads, transitively: their declarations (module members).
 * - Files that load it: only the arguments they pass, since `@use` never
 *   injects the loader's own variables. A chain of legacy `@import`s is
 *   textual inclusion, so there the loader's declarations count too.
 *
 * Two files that only share a partial are never connected. `scans` carry
 * `file` and `loads` (`{ rule, target }`).
 */
export function sassScopes(scans) {
    const known = new Set(scans.map((scan) => scan.file));
    const loads = new Map();
    const loadedBy = new Map();
    for (const { file, loads: targets = [] } of scans) {
        for (const { rule, target } of targets) {
            const loaded = candidates(file, target).find((c) => known.has(c));
            if (!loaded) continue;
            if (!loads.has(file)) loads.set(file, []);
            loads.get(file).push(loaded);
            if (!loadedBy.has(loaded)) loadedBy.set(loaded, []);
            loadedBy.get(loaded).push({ file, textual: rule === 'import' });
        }
    }

    const cache = new Map();
    return (file) => {
        if (cache.has(file)) return cache.get(file);
        const scope = new Map([
            [file, { declarations: true, arguments: true }],
        ]);
        const down = [file];
        const visitedDown = new Set(down);
        while (down.length > 0) {
            for (const next of loads.get(down.pop()) ?? []) {
                merge(scope, next, { declarations: true, arguments: false });
                if (!visitedDown.has(next)) {
                    visitedDown.add(next);
                    down.push(next);
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
}
