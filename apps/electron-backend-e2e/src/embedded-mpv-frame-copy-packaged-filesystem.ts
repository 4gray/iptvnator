import {
    chmodSync,
    copyFileSync,
    linkSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    readlinkSync,
    renameSync,
    rmSync,
    symlinkSync,
    type Stats,
} from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { getPackagedLinuxNativeDir } from './electron-test-fixtures';

export type DisposablePackagedLinuxApp = {
    cleanup: () => void;
    executablePath: string;
    nativeDir: string;
    packageRoot: string;
    temporaryRoot: string;
};

export type DisposablePackagedLinuxAppOptions = {
    linkFile?: (existingPath: string, newPath: string) => void;
};

export type PackagedRuntimeIdentity = {
    arch: string;
    libmpvSoname: string;
    platform: string;
    profile: string;
    runtimeMode: string;
};

export type PackagedEntryKind = 'regular-file' | 'symbolic-link';

export type PackagedEntryGuard = {
    hide: () => void;
    restore: () => void;
};

export type PackagedEntryGuardOptions = {
    expectedKind: PackagedEntryKind;
    hiddenDirectory: string;
};

const HARDLINK_COPY_FALLBACK_CODES = new Set([
    'EACCES',
    'EMLINK',
    'ENOSYS',
    'ENOTSUP',
    'EPERM',
    'EXDEV',
]);
const VERSIONED_LIBMPV_PATTERN = /^libmpv\.so\.\d+(?:\.\d+)*$/;

function entryKindMatches(
    stats: Stats,
    expectedKind: PackagedEntryKind
): boolean {
    return expectedKind === 'regular-file'
        ? stats.isFile() && !stats.isSymbolicLink()
        : stats.isSymbolicLink();
}

function entryExistsByLstat(entryPath: string): boolean {
    try {
        lstatSync(entryPath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

function clonePackagedEntry(
    sourcePath: string,
    destinationPath: string,
    linkFile: (existingPath: string, newPath: string) => void
): void {
    const sourceStats = lstatSync(sourcePath);

    if (sourceStats.isDirectory()) {
        mkdirSync(destinationPath);
        for (const entry of readdirSync(sourcePath)) {
            clonePackagedEntry(
                join(sourcePath, entry),
                join(destinationPath, entry),
                linkFile
            );
        }
        chmodSync(destinationPath, sourceStats.mode & 0o7777);
        return;
    }

    if (sourceStats.isSymbolicLink()) {
        symlinkSync(readlinkSync(sourcePath), destinationPath);
        return;
    }

    if (!sourceStats.isFile()) {
        throw new Error(
            `Unsupported packaged runtime entry type at ${sourcePath}.`
        );
    }

    try {
        linkFile(sourcePath, destinationPath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!code || !HARDLINK_COPY_FALLBACK_CODES.has(code)) {
            throw error;
        }
        copyFileSync(sourcePath, destinationPath);
        chmodSync(destinationPath, sourceStats.mode & 0o7777);
    }
}

export function createDisposablePackagedLinuxApp(
    executablePath: string,
    options: DisposablePackagedLinuxAppOptions = {}
): DisposablePackagedLinuxApp {
    const sourceExecutablePath = resolve(executablePath);
    const sourcePackageRoot = dirname(sourceExecutablePath);
    const temporaryRoot = mkdtempSync(
        join(tmpdir(), 'iptvnator-packaged-frame-copy-')
    );
    const packageRoot = join(temporaryRoot, basename(sourcePackageRoot));
    let cleaned = false;

    try {
        clonePackagedEntry(
            sourcePackageRoot,
            packageRoot,
            options.linkFile ?? linkSync
        );
    } catch (error) {
        rmSync(temporaryRoot, { force: true, recursive: true });
        throw error;
    }

    const clonedExecutablePath = join(
        packageRoot,
        basename(sourceExecutablePath)
    );
    return {
        cleanup() {
            if (cleaned) {
                return;
            }
            rmSync(temporaryRoot, { force: true, recursive: true });
            cleaned = true;
        },
        executablePath: clonedExecutablePath,
        nativeDir: getPackagedLinuxNativeDir(clonedExecutablePath),
        packageRoot,
        temporaryRoot,
    };
}

export function createPackagedEntryGuard(
    entryPath: string,
    options: PackagedEntryGuardOptions
): PackagedEntryGuard {
    const guardedEntryPath = resolve(entryPath);
    const hiddenDirectory = resolve(options.hiddenDirectory);
    const hiddenEntryPath = join(
        hiddenDirectory,
        `.${basename(guardedEntryPath)}.e2e-hidden-${process.pid}`
    );
    let hidden = false;

    return {
        hide() {
            const entryStats = lstatSync(guardedEntryPath);
            if (!entryKindMatches(entryStats, options.expectedKind)) {
                throw new Error(
                    `Packaged entry is not a ${options.expectedKind}: ${guardedEntryPath}`
                );
            }
            const hiddenDirectoryStats = lstatSync(hiddenDirectory);
            if (
                hiddenDirectoryStats.isSymbolicLink() ||
                !hiddenDirectoryStats.isDirectory()
            ) {
                throw new Error(
                    `Packaged entry stash is not a regular directory: ${hiddenDirectory}`
                );
            }
            if (entryExistsByLstat(hiddenEntryPath)) {
                throw new Error(
                    `Stale hidden packaged entry exists: ${hiddenEntryPath}`
                );
            }
            renameSync(guardedEntryPath, hiddenEntryPath);
            hidden = true;
        },
        restore() {
            if (!hidden) {
                return;
            }
            if (!entryExistsByLstat(hiddenEntryPath)) {
                throw new Error(
                    `Hidden packaged entry disappeared before restore: ${hiddenEntryPath}`
                );
            }
            if (entryExistsByLstat(guardedEntryPath)) {
                throw new Error(
                    `Refusing to overwrite packaged entry during restore: ${guardedEntryPath}`
                );
            }
            renameSync(hiddenEntryPath, guardedEntryPath);
            hidden = false;
        },
    };
}

export function readPackagedRuntimeIdentity(
    nativeDir: string
): PackagedRuntimeIdentity {
    const runtimeManifestPath = join(nativeDir, 'embedded-mpv-runtime.json');
    const parsed = JSON.parse(
        readFileSync(runtimeManifestPath, 'utf8')
    ) as Partial<PackagedRuntimeIdentity>;

    for (const field of [
        'arch',
        'platform',
        'profile',
        'runtimeMode',
    ] as const) {
        if (typeof parsed[field] !== 'string' || !parsed[field]) {
            throw new Error(
                `Packaged runtime manifest ${field} is invalid at ${runtimeManifestPath}.`
            );
        }
    }
    if (
        typeof parsed.libmpvSoname !== 'string' ||
        !VERSIONED_LIBMPV_PATTERN.test(parsed.libmpvSoname)
    ) {
        throw new Error(
            `Packaged runtime manifest libmpvSoname is invalid at ${runtimeManifestPath}.`
        );
    }

    return parsed as PackagedRuntimeIdentity;
}
