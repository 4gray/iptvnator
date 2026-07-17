import {
    chmodSync,
    copyFileSync,
    existsSync,
    linkSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    readlinkSync,
    renameSync,
    rmSync,
    statSync,
    symlinkSync,
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
    platform: string;
    profile: string;
    runtimeMode: string;
};

export type RuntimeManifestGuard = {
    hide: () => void;
    restore: () => void;
};

const HARDLINK_COPY_FALLBACK_CODES = new Set([
    'EACCES',
    'EMLINK',
    'ENOSYS',
    'ENOTSUP',
    'EPERM',
    'EXDEV',
]);

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

export function createRuntimeManifestGuard(
    nativeDir: string
): RuntimeManifestGuard {
    const runtimeManifestPath = join(nativeDir, 'embedded-mpv-runtime.json');
    const hiddenRuntimeManifestPath = `${runtimeManifestPath}.e2e-hidden-${process.pid}`;
    let hidden = false;

    return {
        hide() {
            if (!statSync(runtimeManifestPath).isFile()) {
                throw new Error(
                    `Packaged runtime manifest is not a regular file: ${runtimeManifestPath}`
                );
            }
            if (existsSync(hiddenRuntimeManifestPath)) {
                throw new Error(
                    `Stale hidden runtime manifest exists: ${hiddenRuntimeManifestPath}`
                );
            }
            renameSync(runtimeManifestPath, hiddenRuntimeManifestPath);
            hidden = true;
        },
        restore() {
            if (!hidden) {
                return;
            }
            if (!existsSync(hiddenRuntimeManifestPath)) {
                throw new Error(
                    `Hidden runtime manifest disappeared before restore: ${hiddenRuntimeManifestPath}`
                );
            }
            if (existsSync(runtimeManifestPath)) {
                throw new Error(
                    `Refusing to overwrite runtime manifest during restore: ${runtimeManifestPath}`
                );
            }
            renameSync(hiddenRuntimeManifestPath, runtimeManifestPath);
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

    return parsed as PackagedRuntimeIdentity;
}
