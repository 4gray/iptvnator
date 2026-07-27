import {
    constants,
    type BigIntStats,
    type Stats,
} from 'node:fs';
import {
    lstat,
    open,
    readdir,
    type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { REPLAY_MAX_FIXTURE_BYTES } from '@iptvnator/portal/stalker/replay-fixtures';
import {
    FIXTURE_VALIDATION_ERROR_CODES,
    FixtureValidationError,
    validateReplayFixtureText,
} from './fixture-validator';

export const FIXTURE_VALIDATION_CLI_ERROR_CODES = {
    FixtureRootUnavailable: 'fixture-root-unavailable',
    NoFixtures: 'no-fixtures',
    TooManyFixtures: 'too-many-fixtures',
    UnsafeFixturePath: 'unsafe-fixture-path',
    FixtureReadFailed: 'fixture-read-failed',
    InvalidUtf8: 'invalid-utf8',
    NoncanonicalFormat: 'noncanonical-format',
    UnsupportedCommand: 'unsupported-command',
    InternalError: 'internal-error',
} as const;

export type FixtureValidationCliErrorCode =
    (typeof FIXTURE_VALIDATION_CLI_ERROR_CODES)[keyof typeof FIXTURE_VALIDATION_CLI_ERROR_CODES];

export class FixtureValidationCliError extends Error {
    constructor(readonly code: FixtureValidationCliErrorCode) {
        super(`Stalker fixture validation failed: ${code}.`);
        this.name = 'FixtureValidationCliError';
    }
}

const MAX_FIXTURE_COUNT = 256;
const MAX_DIRECTORY_DEPTH = 8;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function validateReplayFixtureDirectory(
    fixtureRoot: string
): Promise<number> {
    let rootStat: Stats;
    try {
        rootStat = await lstat(fixtureRoot);
    } catch {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.FixtureRootUnavailable);
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath);
    }

    const fixturePaths: string[] = [];
    await collectFixturePaths(fixtureRoot, fixturePaths, 0);
    if (fixturePaths.length === 0) {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.NoFixtures);
    }

    for (const fixturePath of fixturePaths) {
        const text = await readFixtureFileBoundedForValidation(fixturePath);
        const validated = validateReplayFixtureText(text);
        if (validated.formatted !== text) {
            reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.NoncanonicalFormat);
        }
    }

    return fixturePaths.length;
}

/**
 * Internal file-boundary helper exported for deterministic race regression
 * coverage. It is deliberately omitted from the package public index.
 */
export async function readFixtureFileBoundedForValidation(
    fixturePath: string,
    beforeOpen: () => Promise<void> = async () => undefined
): Promise<string> {
    let handle: FileHandle | undefined;
    try {
        const preflight = await lstat(fixturePath, { bigint: true });
        assertSafeRegularFile(preflight);
        assertFixtureSize(preflight.size);

        await beforeOpen();
        handle = await open(
            fixturePath,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
        const opened = await handle.stat({ bigint: true });
        assertSafeRegularFile(opened);
        assertSameFile(preflight, opened);
        assertFixtureSize(opened.size);

        const content = await readBounded(handle);
        const afterRead = await handle.stat({ bigint: true });
        const afterPath = await lstat(fixturePath, { bigint: true });
        assertSafeRegularFile(afterRead);
        assertSafeRegularFile(afterPath);
        assertSameFile(opened, afterRead);
        assertSameFile(opened, afterPath);
        assertFixtureSize(afterRead.size);
        assertFixtureSize(afterPath.size);
        if (BigInt(content.byteLength) !== afterRead.size) {
            reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath);
        }

        await handle.close();
        handle = undefined;
        return content.text;
    } catch (error) {
        if (
            error instanceof FixtureValidationCliError ||
            error instanceof FixtureValidationError
        ) {
            throw error;
        }
        throw new FixtureValidationCliError(
            FIXTURE_VALIDATION_CLI_ERROR_CODES.FixtureReadFailed
        );
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

async function collectFixturePaths(
    directory: string,
    fixturePaths: string[],
    depth: number
): Promise<void> {
    if (depth > MAX_DIRECTORY_DEPTH) {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath);
    }

    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.FixtureReadFailed);
    }
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));

    for (const entry of entries) {
        if (
            !SAFE_PATH_SEGMENT.test(entry.name) ||
            entry.isSymbolicLink() ||
            (!entry.isDirectory() && !entry.isFile())
        ) {
            reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath);
        }

        const entryPath = join(directory, entry.name);
        if (entry.isDirectory()) {
            await collectFixturePaths(entryPath, fixturePaths, depth + 1);
            continue;
        }
        if (!entry.name.endsWith('.json')) {
            reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath);
        }
        fixturePaths.push(entryPath);
        if (fixturePaths.length > MAX_FIXTURE_COUNT) {
            reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.TooManyFixtures);
        }
    }
}

async function readBounded(
    handle: FileHandle
): Promise<{ byteLength: number; text: string }> {
    const buffer = Buffer.allocUnsafe(REPLAY_MAX_FIXTURE_BYTES + 1);
    let byteLength = 0;
    while (byteLength < buffer.length) {
        const result = await handle.read(
            buffer,
            byteLength,
            buffer.length - byteLength,
            byteLength
        );
        if (result.bytesRead === 0) {
            break;
        }
        byteLength += result.bytesRead;
    }
    assertFixtureSize(byteLength);
    return {
        byteLength,
        text: decodeUtf8(buffer, byteLength),
    };
}

function decodeUtf8(buffer: Buffer, byteLength: number): string {
    try {
        return new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
        }).decode(buffer.subarray(0, byteLength));
    } catch {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.InvalidUtf8);
    }
}

function assertSafeRegularFile(stat: BigIntStats): void {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath);
    }
}

function assertSameFile(expected: BigIntStats, actual: BigIntStats): void {
    if (
        expected.dev !== actual.dev ||
        expected.ino !== actual.ino ||
        expected.mode !== actual.mode ||
        expected.size !== actual.size ||
        expected.mtimeNs !== actual.mtimeNs ||
        expected.ctimeNs !== actual.ctimeNs
    ) {
        reject(FIXTURE_VALIDATION_CLI_ERROR_CODES.UnsafeFixturePath);
    }
}

function assertFixtureSize(size: number | bigint): void {
    if (BigInt(size) > BigInt(REPLAY_MAX_FIXTURE_BYTES)) {
        throw new FixtureValidationError(
            FIXTURE_VALIDATION_ERROR_CODES.FixtureTooLarge
        );
    }
}

function reject(code: FixtureValidationCliErrorCode): never {
    throw new FixtureValidationCliError(code);
}

function compareCodeUnits(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}
