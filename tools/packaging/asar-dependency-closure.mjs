/**
 * Verifies that a packaged Electron `app.asar` ships a self-consistent set of
 * runtime node_modules: every package inside the archive has its own
 * non-optional dependencies shipped alongside it.
 *
 * electron-builder's pnpm dependency collector reads `pnpm list --json`, which
 * deduplicates repeated packages and reports empty `dependencies` for all but
 * one occurrence. That makes it silently drop deeply-nested transitive
 * dependencies (for example `ms` under `debug`) from the packaged archive, which
 * crashes the app on launch ("Cannot find module 'ms'", issue #1103).
 *
 * These helpers audit every package that is actually shipped inside the asar and
 * report any non-optional dependency of a shipped package that is missing,
 * resolving each one the way Node would inside the packaged tree. IO is injected
 * so the core logic stays pure and unit-testable without a real archive.
 */

import path from 'node:path';

const PACKAGE_MANIFEST = 'package.json';
const NODE_MODULES_SEGMENT = '/node_modules/';

/**
 * A genuine installed package lives directly under a node_modules directory as
 * `<name>` or `@scope/<name>`. Nested folders that merely carry their own
 * package.json (for example `fast-uri/benchmark` or `<pkg>/test`) are not
 * packages and must not be treated as dependency sources.
 */
function isPackageRootDir(dir) {
    const boundary = dir.lastIndexOf(NODE_MODULES_SEGMENT);
    if (boundary === -1) {
        return false;
    }

    const relative = dir.slice(boundary + NODE_MODULES_SEGMENT.length);
    const segments = relative.split('/');

    return segments[0].startsWith('@')
        ? segments.length === 2
        : segments.length === 1;
}

/**
 * Collects every genuine installed package directory in the archive (those that
 * sit directly under a node_modules as `<name>` or `@scope/<name>`). Entry paths
 * are leading-slash posix.
 */
export function collectAsarPackageDirs(asarEntries) {
    const packageDirs = new Set();

    for (const entry of asarEntries) {
        if (!entry.endsWith(`/${PACKAGE_MANIFEST}`)) {
            continue;
        }

        const dir = entry.slice(0, -(PACKAGE_MANIFEST.length + 1));
        if (isPackageRootDir(dir)) {
            packageDirs.add(dir);
        }
    }

    return packageDirs;
}

/**
 * Mirrors Node's upward node_modules resolution across the packaged tree, which
 * is what electron-builder's hoisting produces. Walks every ancestor directory
 * (not just node_modules boundaries) so a dependency hoisted to the archive
 * root still resolves for a package that lives under an app subdirectory such
 * as `/electron-backend/node_modules/foo`. Returns the resolved package
 * directory or null when the dependency is absent.
 */
export function resolvePackagedDependency(fromDir, dependencyName, packageDirs) {
    let current = fromDir;

    while (true) {
        // Node never looks inside `.../node_modules/node_modules`.
        if (!current.endsWith(NODE_MODULES_SEGMENT.slice(0, -1))) {
            const candidate = `${current}/node_modules/${dependencyName}`;
            if (packageDirs.has(candidate)) {
                return candidate;
            }
        }

        if (current === '') {
            return null;
        }

        current = current.slice(0, current.lastIndexOf('/'));
    }
}

/**
 * Checks that every package physically shipped inside the asar has its own
 * non-optional dependencies shipped too (node-resolvable from its location).
 * Returns the list of missing dependencies.
 *
 * The app root manifest ('') is intentionally skipped: it declares frontend-only
 * packages (Angular, zone.js, ...) that are compiled into the web bundle rather
 * than shipped as runtime node_modules, so requiring them here would be a false
 * positive. Auditing what is actually bundled still catches the real regression
 * (a shipped `debug` whose transitive `ms` was dropped — issue #1103).
 *
 * @param {Set<string>} packageDirs directories that contain a package.json
 * @param {(packageDir: string) => object | null} readManifest manifest reader
 * @returns {{ dependency: string, requiredBy: string }[]}
 */
export function findMissingPackagedDependencies(packageDirs, readManifest) {
    const missing = [];

    for (const packageDir of packageDirs) {
        if (packageDir === '') {
            continue;
        }

        const manifest = readManifest(packageDir);
        if (!manifest) {
            continue;
        }

        const optionalDependencies = new Set(
            Object.keys(manifest.optionalDependencies ?? {})
        );
        // Packages sometimes list a host-provided peer (e.g. `electron`) in
        // `dependencies` as well so package managers install it during
        // development; at runtime the host supplies it, so its absence from
        // the archive is not a packaging defect.
        const peerDependencies = new Set(
            Object.keys(manifest.peerDependencies ?? {})
        );

        for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
            if (
                optionalDependencies.has(dependencyName) ||
                peerDependencies.has(dependencyName)
            ) {
                continue;
            }

            if (
                !resolvePackagedDependency(
                    packageDir,
                    dependencyName,
                    packageDirs
                )
            ) {
                missing.push({
                    dependency: dependencyName,
                    requiredBy: packageDir,
                });
            }
        }
    }

    return missing;
}

/**
 * Inspects a real `app.asar` for missing runtime dependencies. `listPackage` and
 * `extractFile` are injected (normally from `@electron/asar`).
 *
 * `@electron/asar` builds listing entries and resolves lookup paths with the
 * HOST separator: on Windows `listPackage` returns entries like
 * `\node_modules\debug\package.json` and `extractFile` splits its path on
 * `path.sep`. The pure helpers above are posix-only, so listings are normalized
 * to posix and lookup paths converted back to the host separator (`pathSep` is
 * injectable for tests). Without this the guard silently audited nothing on
 * Windows.
 *
 * Returns `{ missing, packageCount, manifestReadFailures }` so callers can
 * reject a vacuous pass: a packaged app always ships node_modules, so
 * `packageCount === 0` or read failures indicate the guard itself is broken,
 * not a healthy archive.
 */
export function inspectPackagedDependencyClosure(
    asarPath,
    { listPackage, extractFile, pathSep = path.sep }
) {
    const toPosix = (value) =>
        pathSep === '\\' ? value.replaceAll('\\', '/') : value;
    const toHostPath = (value) =>
        pathSep === '\\' ? value.replaceAll('/', '\\') : value;

    const packageDirs = collectAsarPackageDirs(
        listPackage(asarPath).map(toPosix)
    );
    const manifestCache = new Map();
    const manifestReadFailures = [];

    const readManifest = (packageDir) => {
        if (manifestCache.has(packageDir)) {
            return manifestCache.get(packageDir);
        }

        const relativePath = toHostPath(
            (packageDir === '' ? '' : `${packageDir.slice(1)}/`) +
                PACKAGE_MANIFEST
        );

        let manifest = null;

        try {
            manifest = JSON.parse(
                extractFile(asarPath, relativePath).toString('utf8')
            );
        } catch (error) {
            manifestReadFailures.push({
                packageDir,
                message: error.message,
            });
            manifest = null;
        }

        manifestCache.set(packageDir, manifest);
        return manifest;
    };

    const missing = findMissingPackagedDependencies(packageDirs, readManifest);

    return {
        missing,
        packageCount: packageDirs.size,
        manifestReadFailures,
    };
}
