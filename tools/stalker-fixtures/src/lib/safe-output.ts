import { randomBytes } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import {
    link,
    lstat,
    open,
    realpath,
    unlink,
    type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { REPLAY_MAX_FIXTURE_BYTES } from '@iptvnator/portal/stalker/replay-fixtures';
import {
    FixtureValidationError,
    validateReplayFixtureText,
} from './fixture-validator';

export const SAFE_OUTPUT_ERROR_CODES = {
    InvalidDraft: 'invalid-draft',
    OutputTooLarge: 'output-too-large',
    UnsafeOutputPath: 'unsafe-output-path',
    OutputExists: 'output-exists',
    OutputOpenFailed: 'output-open-failed',
    OutputWriteFailed: 'output-write-failed',
    OutputPublishFailed: 'output-publish-failed',
} as const;

export type SafeOutputErrorCode =
    (typeof SAFE_OUTPUT_ERROR_CODES)[keyof typeof SAFE_OUTPUT_ERROR_CODES];

export class SafeOutputError extends Error {
    constructor(readonly code: SafeOutputErrorCode) {
        super(`Stalker HAR conversion failed: ${code}.`);
        this.name = 'SafeOutputError';
    }
}

export interface SafeOutputOptions {
    /**
     * Race-test seam. Production callers must not supply it.
     */
    beforePublish?: (temporaryPath: string) => Promise<void>;
}

const SAFE_OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function writeReplayDraftSafely(
    outputPath: string,
    text: string,
    options: SafeOutputOptions = {}
): Promise<void> {
    validateDraftBeforeWrite(text);
    const absoluteOutput = resolve(outputPath);
    const outputName = basename(absoluteOutput);
    if (!SAFE_OUTPUT_NAME.test(outputName)) {
        reject(SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath);
    }

    const requestedParent = dirname(absoluteOutput);
    const parentPreflight = await safeParentLstat(requestedParent);
    assertSafeDirectory(parentPreflight);
    const canonicalParent = await safeParentRealpath(requestedParent);
    const canonicalParentPreflight = await safeParentLstat(canonicalParent);
    assertSafeDirectory(canonicalParentPreflight);
    assertSameDirectory(parentPreflight, canonicalParentPreflight);

    const canonicalOutput = join(canonicalParent, outputName);
    await assertDestinationAbsent(canonicalOutput);

    let parentHandle: FileHandle | undefined;
    let temporaryHandle: FileHandle | undefined;
    let temporaryPath: string | undefined;
    let stage: 'open' | 'write' | 'publish' = 'open';
    try {
        parentHandle = await open(
            canonicalParent,
            constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
        );
        const openedParent = await parentHandle.stat({ bigint: true });
        assertSafeDirectory(openedParent);
        assertSameDirectory(canonicalParentPreflight, openedParent);

        temporaryPath = join(
            canonicalParent,
            `.${outputName}.${randomBytes(16).toString('hex')}.tmp`
        );
        temporaryHandle = await open(
            temporaryPath,
            constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
            0o600
        );
        const openedTemporary = await temporaryHandle.stat({ bigint: true });
        assertSafeTemporary(openedTemporary, 0n);

        stage = 'write';
        const bytes = Buffer.from(text);
        await writeExactly(temporaryHandle, bytes);
        await temporaryHandle.sync();
        const writtenTemporary = await temporaryHandle.stat({ bigint: true });
        assertSafeTemporary(writtenTemporary, BigInt(bytes.byteLength));
        assertSameFileIdentity(openedTemporary, writtenTemporary);
        await temporaryHandle.close();
        temporaryHandle = undefined;

        stage = 'publish';
        await options.beforePublish?.(temporaryPath);
        await assertParentStillOwned(
            requestedParent,
            canonicalParent,
            canonicalParentPreflight,
            parentHandle
        );
        const readyTemporary = await safeTemporaryLstat(temporaryPath);
        assertSafeTemporary(readyTemporary, BigInt(bytes.byteLength));
        assertSameFileIdentity(openedTemporary, readyTemporary);
        await assertDestinationAbsent(canonicalOutput);

        await publishWithoutOverwrite(temporaryPath, canonicalOutput);
        const linkedTemporary = await safeTemporaryLstat(temporaryPath);
        const linkedOutput = await safeOutputLstat(canonicalOutput);
        assertPublishedLink(
            openedTemporary,
            linkedTemporary,
            linkedOutput,
            BigInt(bytes.byteLength)
        );

        await unlink(temporaryPath);
        temporaryPath = undefined;
        const publishedOutput = await safeOutputLstat(canonicalOutput);
        assertSafePublishedOutput(
            openedTemporary,
            publishedOutput,
            BigInt(bytes.byteLength)
        );
        await parentHandle.sync();
        await parentHandle.close();
        parentHandle = undefined;
    } catch (error) {
        if (error instanceof SafeOutputError) {
            throw error;
        }
        const code =
            stage === 'open'
                ? SAFE_OUTPUT_ERROR_CODES.OutputOpenFailed
                : stage === 'write'
                  ? SAFE_OUTPUT_ERROR_CODES.OutputWriteFailed
                  : SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed;
        throw new SafeOutputError(code);
    } finally {
        await temporaryHandle?.close().catch(() => undefined);
        if (temporaryPath !== undefined) {
            await unlink(temporaryPath).catch(() => undefined);
        }
        await parentHandle?.close().catch(() => undefined);
    }
}

function validateDraftBeforeWrite(text: string): void {
    if (Buffer.byteLength(text) > REPLAY_MAX_FIXTURE_BYTES) {
        reject(SAFE_OUTPUT_ERROR_CODES.OutputTooLarge);
    }
    try {
        const validated = validateReplayFixtureText(text);
        if (validated.formatted !== text) {
            reject(SAFE_OUTPUT_ERROR_CODES.InvalidDraft);
        }
    } catch (error) {
        if (error instanceof SafeOutputError) {
            throw error;
        }
        if (error instanceof FixtureValidationError) {
            reject(SAFE_OUTPUT_ERROR_CODES.InvalidDraft);
        }
        reject(SAFE_OUTPUT_ERROR_CODES.InvalidDraft);
    }
}

async function writeExactly(handle: FileHandle, bytes: Buffer): Promise<void> {
    let offset = 0;
    while (offset < bytes.byteLength) {
        const result = await handle.write(
            bytes,
            offset,
            bytes.byteLength - offset,
            offset
        );
        if (result.bytesWritten <= 0) {
            reject(SAFE_OUTPUT_ERROR_CODES.OutputWriteFailed);
        }
        offset += result.bytesWritten;
    }
}

async function assertParentStillOwned(
    requestedParent: string,
    canonicalParent: string,
    expected: BigIntStats,
    parentHandle: FileHandle
): Promise<void> {
    const requested = await safeParentLstat(requestedParent);
    const canonical = await safeParentLstat(canonicalParent);
    const opened = await parentHandle.stat({ bigint: true });
    for (const actual of [requested, canonical, opened]) {
        assertSafeDirectory(actual);
        assertSameDirectory(expected, actual);
    }
}

async function publishWithoutOverwrite(
    temporaryPath: string,
    outputPath: string
): Promise<void> {
    try {
        /*
         * Node does not expose renameat2(RENAME_NOREPLACE). A same-directory
         * hard-link publication has the required atomic, no-overwrite
         * property: the complete inode appears at the destination in one
         * operation, and EEXIST wins over files and symlinks.
         */
        await link(temporaryPath, outputPath);
    } catch (error) {
        if (isNodeError(error) && error.code === 'EEXIST') {
            reject(SAFE_OUTPUT_ERROR_CODES.OutputExists);
        }
        reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
    }
}

async function assertDestinationAbsent(path: string): Promise<void> {
    try {
        await lstat(path);
        reject(SAFE_OUTPUT_ERROR_CODES.OutputExists);
    } catch (error) {
        if (error instanceof SafeOutputError) {
            throw error;
        }
        if (isNodeError(error) && error.code === 'ENOENT') {
            return;
        }
        reject(SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath);
    }
}

async function safeParentLstat(path: string): Promise<BigIntStats> {
    try {
        return await lstat(path, { bigint: true });
    } catch {
        reject(SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath);
    }
}

async function safeParentRealpath(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        reject(SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath);
    }
}

async function safeTemporaryLstat(path: string): Promise<BigIntStats> {
    try {
        return await lstat(path, { bigint: true });
    } catch {
        reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
    }
}

async function safeOutputLstat(path: string): Promise<BigIntStats> {
    try {
        return await lstat(path, { bigint: true });
    } catch {
        reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
    }
}

function assertSafeDirectory(stat: BigIntStats): void {
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        reject(SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath);
    }
}

function assertSameDirectory(expected: BigIntStats, actual: BigIntStats): void {
    if (
        expected.dev !== actual.dev ||
        expected.ino !== actual.ino ||
        expected.mode !== actual.mode
    ) {
        reject(SAFE_OUTPUT_ERROR_CODES.UnsafeOutputPath);
    }
}

function assertSafeTemporary(stat: BigIntStats, size: bigint): void {
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1n ||
        stat.size !== size ||
        (stat.mode & 0o777n) !== 0o600n
    ) {
        reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
    }
}

function assertPublishedLink(
    opened: BigIntStats,
    temporary: BigIntStats,
    output: BigIntStats,
    size: bigint
): void {
    for (const stat of [temporary, output]) {
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 2n ||
            stat.size !== size ||
            (stat.mode & 0o777n) !== 0o600n
        ) {
            reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
        }
        assertSameFileIdentity(opened, stat);
    }
    assertSameFileSnapshot(temporary, output);
}

function assertSafePublishedOutput(
    opened: BigIntStats,
    output: BigIntStats,
    size: bigint
): void {
    if (
        !output.isFile() ||
        output.isSymbolicLink() ||
        output.nlink !== 1n ||
        output.size !== size ||
        (output.mode & 0o777n) !== 0o600n
    ) {
        reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
    }
    assertSameFileIdentity(opened, output);
}

function assertSameFileIdentity(
    expected: BigIntStats,
    actual: BigIntStats
): void {
    if (
        expected.dev !== actual.dev ||
        expected.ino !== actual.ino ||
        expected.mode !== actual.mode
    ) {
        reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
    }
}

function assertSameFileSnapshot(
    expected: BigIntStats,
    actual: BigIntStats
): void {
    if (
        expected.dev !== actual.dev ||
        expected.ino !== actual.ino ||
        expected.mode !== actual.mode ||
        expected.size !== actual.size ||
        expected.mtimeNs !== actual.mtimeNs ||
        expected.ctimeNs !== actual.ctimeNs
    ) {
        reject(SAFE_OUTPUT_ERROR_CODES.OutputPublishFailed);
    }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        typeof (error as { code?: unknown }).code === 'string'
    );
}

function reject(code: SafeOutputErrorCode): never {
    throw new SafeOutputError(code);
}
