/* eslint-disable max-lines -- Keep the no-follow reader, race checks, and bounded JSON preflight in one auditable module. */
import { execFile } from 'node:child_process';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { TextDecoder } from 'node:util';

export const HAR_READER_ERROR_CODES = {
    InputUnavailable: 'input-unavailable',
    UnsafeInputPath: 'unsafe-input-path',
    InputInsideWorktree: 'input-inside-worktree',
    WorktreeDiscoveryFailed: 'worktree-discovery-failed',
    InputReadFailed: 'input-read-failed',
    HarTooLarge: 'har-too-large',
    InvalidUtf8: 'invalid-utf8',
    HarTooDeep: 'har-too-deep',
    HarCollectionTooLarge: 'har-collection-too-large',
    HarStringTooLarge: 'har-string-too-large',
    HarStructureTooLarge: 'har-structure-too-large',
    InvalidHarJson: 'invalid-har-json',
    InvalidBase64: 'invalid-base64',
    DecodedBodyTooLarge: 'decoded-body-too-large',
} as const;

export type HarReaderErrorCode =
    (typeof HAR_READER_ERROR_CODES)[keyof typeof HAR_READER_ERROR_CODES];

export class HarReaderError extends Error {
    constructor(readonly code: HarReaderErrorCode) {
        super(`Stalker HAR conversion failed: ${code}.`);
        this.name = 'HarReaderError';
    }
}

export const HAR_READER_LIMITS = {
    MaxRawBytes: 16 * 1024 * 1024,
    MaxDecodedBodyBytes: 1024 * 1024,
    MaxAggregateDecodedBodyBytes: 8 * 1024 * 1024,
    MaxJsonDepth: 32,
    MaxCollectionItems: 512,
    MaxStringBytes: 2 * 1024 * 1024,
    MaxJsonNodes: 32 * 1024,
    MaxWorktreeOutputBytes: 256 * 1024,
    MaxWorktrees: 256,
    MaxWorktreePathBytes: 16 * 1024,
} as const;

export interface HarReaderOptions {
    /**
     * Test seam and embeddable-call override. Production callers omit this so
     * every Git worktree registered for the repository is discovered.
     */
    worktreeRoots?: readonly string[];
    /**
     * Race-test seam. Production callers must not supply it.
     */
    beforeOpen?: () => Promise<void>;
}

interface JsonCollectionFrame {
    kind: '[' | '{';
    commas: number;
    hasContent: boolean;
}

export async function readHarFile(
    inputPath: string,
    options: HarReaderOptions = {}
): Promise<unknown> {
    const preflight = await safeInputLstat(inputPath);
    assertSafeInputFile(preflight);
    assertRawSize(preflight.size);

    const canonicalInput = await safeRealpath(
        inputPath,
        HAR_READER_ERROR_CODES.UnsafeInputPath
    );
    const canonicalPreflight = await safeInputLstat(canonicalInput);
    assertSafeInputFile(canonicalPreflight);
    assertSameInput(preflight, canonicalPreflight);

    const worktreeRoots =
        options.worktreeRoots === undefined
            ? await discoverGitWorktreeRoots()
            : options.worktreeRoots;
    await assertOutsideEveryWorktree(canonicalInput, worktreeRoots);

    let handle: FileHandle | undefined;
    try {
        await options.beforeOpen?.();
        handle = await open(
            canonicalInput,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
        );
        const opened = await handle.stat({ bigint: true });
        assertSafeInputFile(opened);
        assertSameInput(canonicalPreflight, opened);
        assertRawSize(opened.size);

        const bytes = await readBounded(handle);
        const afterRead = await handle.stat({ bigint: true });
        const afterOriginalPath = await lstat(inputPath, { bigint: true });
        const afterCanonicalPath = await lstat(canonicalInput, {
            bigint: true,
        });
        for (const stat of [afterRead, afterOriginalPath, afterCanonicalPath]) {
            assertSafeInputFile(stat);
            assertSameInput(opened, stat);
            assertRawSize(stat.size);
        }
        if (BigInt(bytes.byteLength) !== afterRead.size) {
            reject(HAR_READER_ERROR_CODES.UnsafeInputPath);
        }

        await handle.close();
        handle = undefined;
        const text = decodeUtf8(bytes);
        preflightJsonStructure(text);
        return parseBoundedJson(text);
    } catch (error) {
        if (error instanceof HarReaderError) {
            throw error;
        }
        throw new HarReaderError(HAR_READER_ERROR_CODES.InputReadFailed);
    } finally {
        await handle?.close().catch(() => undefined);
    }
}

export function decodeHarBase64(value: string): Buffer {
    const maximumEncodedBytes =
        Math.ceil(HAR_READER_LIMITS.MaxDecodedBodyBytes / 3) * 4;
    if (
        Buffer.byteLength(value, 'ascii') > maximumEncodedBytes ||
        !isCanonicalBase64Syntax(value)
    ) {
        if (Buffer.byteLength(value, 'ascii') > maximumEncodedBytes) {
            reject(HAR_READER_ERROR_CODES.DecodedBodyTooLarge);
        }
        reject(HAR_READER_ERROR_CODES.InvalidBase64);
    }

    const decoded = Buffer.from(value, 'base64');
    if (decoded.byteLength > HAR_READER_LIMITS.MaxDecodedBodyBytes) {
        reject(HAR_READER_ERROR_CODES.DecodedBodyTooLarge);
    }
    if (decoded.toString('base64') !== value) {
        reject(HAR_READER_ERROR_CODES.InvalidBase64);
    }
    return decoded;
}

export function parseGitWorktreeList(output: string): string[] {
    if (Buffer.byteLength(output) > HAR_READER_LIMITS.MaxWorktreeOutputBytes) {
        reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
    }

    const roots: string[] = [];
    const records = output.split('\0\0');
    const finalRecord = records.pop();
    if (finalRecord !== '') {
        reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
    }

    for (const record of records) {
        const fields = record.split('\0');
        const worktree = fields[0];
        if (
            worktree === undefined ||
            !worktree.startsWith('worktree ') ||
            worktree.length === 'worktree '.length
        ) {
            reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
        }
        const root = worktree.slice('worktree '.length);
        if (
            !isAbsolute(root) ||
            Buffer.byteLength(root) > HAR_READER_LIMITS.MaxWorktreePathBytes ||
            root.includes('\n') ||
            root.includes('\r')
        ) {
            reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
        }
        roots.push(root);
        if (roots.length > HAR_READER_LIMITS.MaxWorktrees) {
            reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
        }
    }

    if (roots.length === 0) {
        reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
    }
    return roots;
}

async function safeInputLstat(path: string): Promise<BigIntStats> {
    try {
        return await lstat(path, { bigint: true });
    } catch {
        reject(HAR_READER_ERROR_CODES.InputUnavailable);
    }
}

async function safeRealpath(
    path: string,
    code: HarReaderErrorCode
): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        reject(code);
    }
}

async function discoverGitWorktreeRoots(): Promise<readonly string[]> {
    let stdout: Buffer;
    try {
        stdout = await executeGitWorktreeList();
    } catch {
        reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
    }
    let text: string;
    try {
        text = new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
        }).decode(stdout);
    } catch {
        reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
    }
    const roots = parseGitWorktreeList(text);
    return Promise.all(
        roots.map((root) =>
            safeRealpath(root, HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed)
        )
    );
}

function executeGitWorktreeList(): Promise<Buffer> {
    return new Promise((resolvePromise, rejectPromise) => {
        execFile(
            'git',
            ['worktree', 'list', '--porcelain', '-z'],
            {
                cwd: process.cwd(),
                encoding: 'buffer',
                maxBuffer: HAR_READER_LIMITS.MaxWorktreeOutputBytes,
                timeout: 5_000,
                windowsHide: true,
            },
            (error, stdout) => {
                if (error !== null || !Buffer.isBuffer(stdout)) {
                    rejectPromise(error ?? new Error('invalid git output'));
                    return;
                }
                resolvePromise(stdout);
            }
        );
    });
}

async function assertOutsideEveryWorktree(
    canonicalInput: string,
    roots: readonly string[]
): Promise<void> {
    if (roots.length > HAR_READER_LIMITS.MaxWorktrees) {
        reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
    }
    for (const root of roots) {
        if (
            !isAbsolute(root) ||
            Buffer.byteLength(root) > HAR_READER_LIMITS.MaxWorktreePathBytes
        ) {
            reject(HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed);
        }
        const canonicalRoot = await safeRealpath(
            root,
            HAR_READER_ERROR_CODES.WorktreeDiscoveryFailed
        );
        const pathFromRoot = relative(canonicalRoot, canonicalInput);
        if (
            pathFromRoot === '' ||
            (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot))
        ) {
            reject(HAR_READER_ERROR_CODES.InputInsideWorktree);
        }
    }
}

async function readBounded(handle: FileHandle): Promise<Buffer> {
    const buffer = Buffer.allocUnsafe(HAR_READER_LIMITS.MaxRawBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
        const result = await handle.read(
            buffer,
            offset,
            buffer.length - offset,
            offset
        );
        if (result.bytesRead === 0) {
            break;
        }
        offset += result.bytesRead;
    }
    assertRawSize(offset);
    return buffer.subarray(0, offset);
}

function decodeUtf8(bytes: Buffer): string {
    try {
        return new TextDecoder('utf-8', {
            fatal: true,
            ignoreBOM: true,
        }).decode(bytes);
    } catch {
        reject(HAR_READER_ERROR_CODES.InvalidUtf8);
    }
}

function preflightJsonStructure(text: string): void {
    const stack: JsonCollectionFrame[] = [];
    let inString = false;
    let escaped = false;

    for (const character of text) {
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
                markCollectionContent(stack);
            }
            continue;
        }

        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '[' || character === '{') {
            markCollectionContent(stack);
            stack.push({
                kind: character,
                commas: 0,
                hasContent: false,
            });
            if (stack.length > HAR_READER_LIMITS.MaxJsonDepth) {
                reject(HAR_READER_ERROR_CODES.HarTooDeep);
            }
            continue;
        }
        if (character === ']' || character === '}') {
            const frame = stack.pop();
            if (
                frame !== undefined &&
                ((character === ']' && frame.kind !== '[') ||
                    (character === '}' && frame.kind !== '{'))
            ) {
                reject(HAR_READER_ERROR_CODES.InvalidHarJson);
            }
            if (
                frame?.hasContent === true &&
                frame.commas + 1 > HAR_READER_LIMITS.MaxCollectionItems
            ) {
                reject(HAR_READER_ERROR_CODES.HarCollectionTooLarge);
            }
            continue;
        }
        if (character === ',') {
            const frame = stack.at(-1);
            if (frame !== undefined) {
                frame.commas += 1;
                if (frame.commas >= HAR_READER_LIMITS.MaxCollectionItems) {
                    reject(HAR_READER_ERROR_CODES.HarCollectionTooLarge);
                }
            }
            continue;
        }
        if (!/\s/u.test(character) && character !== ':') {
            markCollectionContent(stack);
        }
    }
}

function markCollectionContent(stack: JsonCollectionFrame[]): void {
    const frame = stack.at(-1);
    if (frame !== undefined) {
        frame.hasContent = true;
    }
}

function parseBoundedJson(text: string): unknown {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch {
        reject(HAR_READER_ERROR_CODES.InvalidHarJson);
    }
    assertBoundedJsonValue(value);
    return value;
}

function assertBoundedJsonValue(root: unknown): void {
    const pending: Array<{ depth: number; value: unknown }> = [
        { depth: 0, value: root },
    ];
    let nodes = 0;

    while (pending.length > 0) {
        const current = pending.pop();
        if (current === undefined) {
            continue;
        }
        nodes += 1;
        if (nodes > HAR_READER_LIMITS.MaxJsonNodes) {
            reject(HAR_READER_ERROR_CODES.HarStructureTooLarge);
        }
        if (current.depth > HAR_READER_LIMITS.MaxJsonDepth) {
            reject(HAR_READER_ERROR_CODES.HarTooDeep);
        }
        if (typeof current.value === 'string') {
            if (
                Buffer.byteLength(current.value) >
                HAR_READER_LIMITS.MaxStringBytes
            ) {
                reject(HAR_READER_ERROR_CODES.HarStringTooLarge);
            }
            continue;
        }
        if (Array.isArray(current.value)) {
            if (current.value.length > HAR_READER_LIMITS.MaxCollectionItems) {
                reject(HAR_READER_ERROR_CODES.HarCollectionTooLarge);
            }
            for (const item of current.value) {
                pending.push({
                    depth: current.depth + 1,
                    value: item,
                });
            }
            continue;
        }
        if (isRecord(current.value)) {
            const entries = Object.entries(current.value);
            if (entries.length > HAR_READER_LIMITS.MaxCollectionItems) {
                reject(HAR_READER_ERROR_CODES.HarCollectionTooLarge);
            }
            for (const [key, child] of entries) {
                if (Buffer.byteLength(key) > HAR_READER_LIMITS.MaxStringBytes) {
                    reject(HAR_READER_ERROR_CODES.HarStringTooLarge);
                }
                pending.push({
                    depth: current.depth + 1,
                    value: child,
                });
            }
        }
    }
}

function isCanonicalBase64Syntax(value: string): boolean {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSafeInputFile(stat: BigIntStats): void {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
        reject(HAR_READER_ERROR_CODES.UnsafeInputPath);
    }
}

function assertSameInput(expected: BigIntStats, actual: BigIntStats): void {
    if (
        expected.dev !== actual.dev ||
        expected.ino !== actual.ino ||
        expected.mode !== actual.mode ||
        expected.size !== actual.size ||
        expected.mtimeNs !== actual.mtimeNs ||
        expected.ctimeNs !== actual.ctimeNs
    ) {
        reject(HAR_READER_ERROR_CODES.UnsafeInputPath);
    }
}

function assertRawSize(size: number | bigint): void {
    if (BigInt(size) > BigInt(HAR_READER_LIMITS.MaxRawBytes)) {
        reject(HAR_READER_ERROR_CODES.HarTooLarge);
    }
}

function reject(code: HarReaderErrorCode): never {
    throw new HarReaderError(code);
}
