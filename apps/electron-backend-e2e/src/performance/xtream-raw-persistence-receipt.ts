import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { readXtreamSafeRegularFile } from './xtream-safe-file-read';
import type {
    XtreamPersistedRawEvidence,
    XtreamPersistenceReceipt,
} from './xtream-summary-contract';

export async function verifyXtreamPersistenceReceipt(
    serialized: string,
    receipt: XtreamPersistenceReceipt
): Promise<XtreamPersistedRawEvidence> {
    const bytes = Buffer.from(serialized, 'utf8');
    const rawSha256 = sha256(bytes);
    try {
        if (!hasExactReceiptShape(receipt)) {
            invalidReceipt();
        }
        const {
            absolutePath,
            bytes: persistedBytes,
            sha256: persistedSha256,
        } = receipt;
        if (
            typeof absolutePath !== 'string' ||
            !isAbsolute(absolutePath) ||
            persistedBytes !== bytes.byteLength ||
            persistedSha256 !== rawSha256
        ) {
            invalidReceipt();
        }
        const { content: persisted, realPath: path } =
            await readXtreamSafeRegularFile(absolutePath);
        if (!persisted.equals(bytes)) invalidReceipt();
        return {
            bytes: bytes.byteLength,
            pathSha256: sha256(Buffer.from(path, 'utf8')),
            rawSha256,
        };
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'invalid Xtream persistence receipt'
        ) {
            throw error;
        }
        invalidReceipt();
    }
}

function hasExactReceiptShape(
    value: unknown
): value is XtreamPersistenceReceipt {
    try {
        if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value) ||
            ![Object.prototype, null].includes(Reflect.getPrototypeOf(value))
        ) {
            return false;
        }
        const expected = ['absolutePath', 'bytes', 'sha256'];
        const ownKeys = Reflect.ownKeys(value);
        return (
            ownKeys.length === expected.length &&
            ownKeys.every(
                (key) => typeof key === 'string' && expected.includes(key)
            )
        );
    } catch {
        return false;
    }
}

function sha256(value: Uint8Array): string {
    return createHash('sha256').update(value).digest('hex');
}

function invalidReceipt(): never {
    throw new Error('invalid Xtream persistence receipt');
}
