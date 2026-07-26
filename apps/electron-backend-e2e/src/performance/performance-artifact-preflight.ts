import { statfs } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const MIN_PERFORMANCE_ARTIFACT_FREE_BYTES =
    2n * 1_024n * 1_024n * 1_024n;

interface FileSystemCapacity {
    readonly bavail: bigint;
    readonly bsize: bigint;
}

interface PerformanceArtifactPreflightDependencies {
    readonly statfs?: (path: string) => Promise<FileSystemCapacity>;
}

export interface PerformanceArtifactCapacity {
    readonly availableBytes: bigint;
    readonly checkedPath: string;
    readonly minimumBytes: bigint;
}

async function readFileSystemCapacity(
    path: string
): Promise<FileSystemCapacity> {
    const capacity = await statfs(path, { bigint: true });
    return {
        bavail: capacity.bavail,
        bsize: capacity.bsize,
    };
}

function isMissingPath(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
    );
}

export async function assertPerformanceArtifactCapacity(
    targetPath: string,
    dependencies: PerformanceArtifactPreflightDependencies = {}
): Promise<PerformanceArtifactCapacity> {
    const readCapacity = dependencies.statfs ?? readFileSystemCapacity;
    let checkedPath = resolve(targetPath);

    while (true) {
        try {
            const capacity = await readCapacity(checkedPath);
            const availableBytes = capacity.bavail * capacity.bsize;
            if (availableBytes < MIN_PERFORMANCE_ARTIFACT_FREE_BYTES) {
                throw new Error(
                    `performance-artifact-space-insufficient: benchmark requires at least ${MIN_PERFORMANCE_ARTIFACT_FREE_BYTES} available bytes; ${availableBytes} available at ${checkedPath}`
                );
            }
            return Object.freeze({
                availableBytes,
                checkedPath,
                minimumBytes: MIN_PERFORMANCE_ARTIFACT_FREE_BYTES,
            });
        } catch (error) {
            if (!isMissingPath(error)) {
                throw error;
            }
            const parent = dirname(checkedPath);
            if (parent === checkedPath) {
                throw new Error(
                    `performance-artifact-space-unavailable: no existing ancestor for ${targetPath}`,
                    { cause: error }
                );
            }
            checkedPath = parent;
        }
    }
}
