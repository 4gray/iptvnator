import path from 'path';

const TRUSTED_SNAP_MOUNT_ROOTS = ['/snap', '/var/lib/snapd/snap'] as const;

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

export function resolveTrustedSnapRoot(
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
