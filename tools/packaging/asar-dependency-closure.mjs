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

import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const PACKAGE_MANIFEST = 'package.json';
const NODE_MODULES_SEGMENT = '/node_modules/';
const EMBEDDED_MPV_NATIVE_ARCHIVE_ROOT = '/electron-backend/native';
const ASAR_SIZE_PREFIX_BYTES = 8;
const ASAR_HEADER_MAX_BYTES = 32 * 1024 * 1024;
const ASAR_ENTRY_LIMIT = 250_000;
const ASAR_PATH_MAX_BYTES = 32 * 1024;
const ASAR_LISTED_PATH_MAX_BYTES = 32 * 1024 * 1024;

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function* ownRecordEntries(record) {
    for (const name in record) {
        if (Object.hasOwn(record, name)) {
            yield [name, record[name]];
        }
    }
}

function readExactly(descriptor, buffer, position) {
    let offset = 0;
    while (offset < buffer.length) {
        const bytesRead = fs.readSync(
            descriptor,
            buffer,
            offset,
            buffer.length - offset,
            position + offset
        );
        if (bytesRead === 0) {
            throw new Error('ASAR archive ended before its header was read.');
        }
        offset += bytesRead;
    }
}

/**
 * Lists an ASAR from its bounded Chromium-Pickle JSON header using only Node
 * built-ins. Public-release verification runs from a clean tag checkout, so it
 * cannot rely on the workspace-only `@electron/asar` development dependency.
 */
export function listAsarPackageEntries(
    archivePath,
    { maxListedPathBytes = ASAR_LISTED_PATH_MAX_BYTES } = {}
) {
    if (
        !Number.isSafeInteger(maxListedPathBytes) ||
        maxListedPathBytes <= 0 ||
        maxListedPathBytes > ASAR_LISTED_PATH_MAX_BYTES
    ) {
        throw new Error('ASAR listed-path byte limit is invalid.');
    }
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const descriptor = fs.openSync(
        archivePath,
        fs.constants.O_RDONLY | noFollow
    );
    let header;
    try {
        const archiveStat = fs.fstatSync(descriptor);
        if (!archiveStat.isFile()) {
            throw new Error('ASAR archive must be a regular file.');
        }
        const sizePrefix = Buffer.alloc(ASAR_SIZE_PREFIX_BYTES);
        readExactly(descriptor, sizePrefix, 0);
        if (sizePrefix.readUInt32LE(0) !== 4) {
            throw new Error('ASAR size pickle is malformed.');
        }
        const headerSize = sizePrefix.readUInt32LE(4);
        if (headerSize > ASAR_HEADER_MAX_BYTES) {
            throw new Error(
                `ASAR header exceeds the ${String(
                    ASAR_HEADER_MAX_BYTES
                )}-byte limit.`
            );
        }
        if (
            headerSize < 8 ||
            headerSize + ASAR_SIZE_PREFIX_BYTES > archiveStat.size
        ) {
            throw new Error('ASAR header size is invalid.');
        }
        header = Buffer.alloc(headerSize);
        readExactly(descriptor, header, ASAR_SIZE_PREFIX_BYTES);
    } finally {
        fs.closeSync(descriptor);
    }

    const payloadSize = header.readUInt32LE(0);
    if (payloadSize + 4 !== header.length || payloadSize < 4) {
        throw new Error('ASAR header pickle is malformed.');
    }
    const jsonLength = header.readInt32LE(4);
    const alignedJsonLength =
        jsonLength >= 0 ? Math.ceil(jsonLength / 4) * 4 : -1;
    if (
        jsonLength <= 0 ||
        alignedJsonLength + 4 !== payloadSize ||
        header
            .subarray(8 + jsonLength, 8 + alignedJsonLength)
            .some((byte) => byte !== 0)
    ) {
        throw new Error('ASAR header JSON framing is malformed.');
    }

    let parsedHeader;
    try {
        const headerJson = new TextDecoder('utf-8', { fatal: true }).decode(
            header.subarray(8, 8 + jsonLength)
        );
        parsedHeader = JSON.parse(headerJson);
    } catch (error) {
        throw new Error(
            `ASAR header JSON is invalid: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
    if (!isRecord(parsedHeader) || !isRecord(parsedHeader.files)) {
        throw new Error('ASAR header must contain a files mapping.');
    }

    const entries = [];
    let listedPathBytes = 0;
    const pendingDirectories = [
        {
            entries: ownRecordEntries(parsedHeader.files),
            parentPath: '',
        },
    ];
    while (pendingDirectories.length > 0) {
        const directory = pendingDirectories.at(-1);
        const nextEntry = directory.entries.next();
        if (nextEntry.done) {
            pendingDirectories.pop();
            continue;
        }
        const [name, node] = nextEntry.value;
        const { parentPath } = directory;
        if (
            !name ||
            name === '.' ||
            name === '..' ||
            name.includes('/') ||
            name.includes('\0')
        ) {
            throw new Error('ASAR header contains an invalid path segment.');
        }
        if (!isRecord(node)) {
            throw new Error('ASAR header contains an invalid filesystem node.');
        }
        const entryPath = `${parentPath}/${name}`;
        const entryPathBytes = Buffer.byteLength(entryPath, 'utf8');
        if (entryPathBytes > ASAR_PATH_MAX_BYTES) {
            throw new Error('ASAR header contains an overlong entry path.');
        }
        if (entryPathBytes > maxListedPathBytes - listedPathBytes) {
            throw new Error(
                `Cumulative ASAR entry paths exceed the ${String(
                    maxListedPathBytes
                )}-byte limit.`
            );
        }
        listedPathBytes += entryPathBytes;
        entries.push(entryPath);
        if (entries.length > ASAR_ENTRY_LIMIT) {
            throw new Error(
                `ASAR header exceeds the ${String(ASAR_ENTRY_LIMIT)}-entry limit.`
            );
        }

        if (Object.hasOwn(node, 'files')) {
            if (!isRecord(node.files)) {
                throw new Error(
                    'ASAR header contains an invalid directory mapping.'
                );
            }
            pendingDirectories.push({
                entries: ownRecordEntries(node.files),
                parentPath: entryPath,
            });
        } else if (
            !(
                (Number.isSafeInteger(node.size) && node.size >= 0) ||
                (typeof node.link === 'string' && node.link.length > 0)
            )
        ) {
            throw new Error('ASAR header contains an invalid file node.');
        }
    }
    return entries;
}

/**
 * Embedded MPV's native payload is profile-specific and is written only by
 * afterPack. Any copy retained in app.asar predates that mutation and can leak
 * x64 helpers, runtimes, manifests, or notices into marker-only/system builds.
 */
export function collectEmbeddedMpvNativeArchiveEntries(
    asarEntries,
    pathSep = path.sep
) {
    const toPosix = (value) =>
        pathSep === '\\' ? value.replaceAll('\\', '/') : value;

    return asarEntries
        .map(toPosix)
        .map((entry) => (entry.startsWith('/') ? entry : `/${entry}`))
        .filter(
            (entry) =>
                entry === EMBEDDED_MPV_NATIVE_ARCHIVE_ROOT ||
                entry.startsWith(`${EMBEDDED_MPV_NATIVE_ARCHIVE_ROOT}/`)
        );
}

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
export function resolvePackagedDependency(
    fromDir,
    dependencyName,
    packageDirs
) {
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
