import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';

export interface XtreamSafeFileSnapshot {
    readonly content: Buffer;
    readonly realPath: string;
}

const UNSAFE_FILE_ERROR = 'unsafe-xtream-evidence-file';

export async function readXtreamSafeRegularFile(
    path: string
): Promise<XtreamSafeFileSnapshot> {
    let handle: FileHandle | undefined;
    try {
        const pathBefore = await lstat(path, { bigint: true });
        assertSafeRegularFile(pathBefore);
        handle = await open(
            path,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
        );
        const handleBefore = await handle.stat({ bigint: true });
        assertSafeRegularFile(handleBefore);
        assertSameFile(pathBefore, handleBefore);

        const content = await handle.readFile();
        const handleAfter = await handle.stat({ bigint: true });
        assertSafeRegularFile(handleAfter);
        assertUnchanged(handleBefore, handleAfter);

        const pathAfter = await lstat(path, { bigint: true });
        assertSafeRegularFile(pathAfter);
        assertUnchanged(handleBefore, pathAfter);
        const canonicalPath = await realpath(path);
        const canonicalAfter = await lstat(canonicalPath, { bigint: true });
        assertSafeRegularFile(canonicalAfter);
        assertUnchanged(handleBefore, canonicalAfter);
        const pathFinal = await lstat(path, { bigint: true });
        assertSafeRegularFile(pathFinal);
        assertUnchanged(handleBefore, pathFinal);

        return { content, realPath: canonicalPath };
    } catch {
        throw new Error(UNSAFE_FILE_ERROR);
    } finally {
        await closeHandle(handle);
    }
}

export function isXtreamUnsafeFileError(error: unknown): boolean {
    return error instanceof Error && error.message === UNSAFE_FILE_ERROR;
}

function assertSafeRegularFile(stats: BigIntStats): void {
    if (
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        stats.nlink !== BigInt(1)
    ) {
        throw new Error(UNSAFE_FILE_ERROR);
    }
}

function assertSameFile(left: BigIntStats, right: BigIntStats): void {
    if (left.dev !== right.dev || left.ino !== right.ino) {
        throw new Error(UNSAFE_FILE_ERROR);
    }
}

function assertUnchanged(before: BigIntStats, after: BigIntStats): void {
    assertSameFile(before, after);
    if (
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
    ) {
        throw new Error(UNSAFE_FILE_ERROR);
    }
}

async function closeHandle(handle: FileHandle | undefined): Promise<void> {
    if (!handle) return;
    try {
        await handle.close();
    } catch {
        throw new Error(UNSAFE_FILE_ERROR);
    }
}
