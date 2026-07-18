import path from 'path';
import type { EmbeddedMpvFrameCopyRuntimeMode } from './types';

const TRUSTED_SNAP_MOUNT_ROOTS = ['/snap', '/var/lib/snapd/snap'] as const;
const TRUSTED_SNAP_GL_ROOT = '/var/lib/snapd/lib/gl';

function isPathInside(
    parentPath: string,
    candidatePath: string,
    allowEqual: boolean
): boolean {
    const relativePath = path.relative(parentPath, candidatePath);
    if (relativePath === '') {
        return allowEqual;
    }
    return (
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

function resolveTrustedSnapRoot(
    environment: NodeJS.ProcessEnv,
    nativeDir: string
): string | null {
    const declaredSnapRoot = environment.SNAP;
    if (
        !declaredSnapRoot ||
        !path.isAbsolute(declaredSnapRoot) ||
        !path.isAbsolute(nativeDir)
    ) {
        return null;
    }

    const normalizedSnapRoot = path.resolve(declaredSnapRoot);
    const resemblesReadOnlySnapMount = TRUSTED_SNAP_MOUNT_ROOTS.some(
        (mountRoot) => {
            const relativePath = path.relative(mountRoot, normalizedSnapRoot);
            return (
                isPathInside(mountRoot, normalizedSnapRoot, false) &&
                relativePath.split(path.sep).filter(Boolean).length >= 2
            );
        }
    );
    if (
        !resemblesReadOnlySnapMount ||
        !isPathInside(normalizedSnapRoot, path.resolve(nativeDir), false)
    ) {
        return null;
    }
    return normalizedSnapRoot;
}

function getTrustedSnapLibraryPaths(
    environment: NodeJS.ProcessEnv,
    snapRoot: string
): string[] {
    const snapLibraryPaths = (environment.SNAP_LIBRARY_PATH ?? '')
        .split(':')
        .filter(Boolean)
        .filter((libraryPath) => path.isAbsolute(libraryPath))
        .map((libraryPath) => path.resolve(libraryPath))
        .filter((libraryPath) =>
            isPathInside(TRUSTED_SNAP_GL_ROOT, libraryPath, true)
        );

    return [
        ...snapLibraryPaths,
        path.join(snapRoot, 'lib'),
        path.join(snapRoot, 'usr', 'lib'),
        path.join(snapRoot, 'lib', 'x86_64-linux-gnu'),
        path.join(snapRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
    ];
}

/**
 * Builds the loader environment shared by the bounded startup probe and each
 * real Linux helper session. The validated package profile is authoritative:
 * system packages use the system loader, while bundled packages start at
 * native/lib and may add only immutable-looking Snap runtime/GL roots.
 */
export function createLinuxFrameCopyHelperEnvironment(
    environment: NodeJS.ProcessEnv,
    nativeDir: string,
    runtimeMode: EmbeddedMpvFrameCopyRuntimeMode
): NodeJS.ProcessEnv {
    const helperEnvironment = { ...environment };
    delete helperEnvironment.LD_AUDIT;
    delete helperEnvironment.LD_LIBRARY_PATH;
    delete helperEnvironment.LD_PRELOAD;

    if (runtimeMode === 'system') {
        return helperEnvironment;
    }

    const libraryPaths = [path.join(nativeDir, 'lib')];
    const trustedSnapRoot = resolveTrustedSnapRoot(environment, nativeDir);
    if (trustedSnapRoot) {
        libraryPaths.push(
            ...getTrustedSnapLibraryPaths(environment, trustedSnapRoot)
        );
    }
    helperEnvironment.LD_LIBRARY_PATH = [...new Set(libraryPaths)].join(':');
    return helperEnvironment;
}
