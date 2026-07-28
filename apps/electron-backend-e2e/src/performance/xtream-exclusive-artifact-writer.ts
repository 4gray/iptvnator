import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import type { XtreamPersistenceReceipt } from './xtream-summary-contract';

export async function writeXtreamExclusiveArtifact(
    absolutePath: string,
    serialized: string
): Promise<XtreamPersistenceReceipt> {
    try {
        if (
            typeof absolutePath !== 'string' ||
            !isAbsolute(absolutePath) ||
            typeof serialized !== 'string' ||
            serialized.length === 0
        ) {
            invalid();
        }
        const content = Buffer.from(serialized, 'utf8');
        const handle = await open(absolutePath, 'wx', 0o600);
        try {
            await handle.writeFile(content);
            await handle.sync();
            const stats = await handle.stat();
            if (
                !stats.isFile() ||
                stats.isSymbolicLink() ||
                stats.nlink !== 1 ||
                stats.size !== content.byteLength
            ) {
                invalid();
            }
        } finally {
            await handle.close();
        }
        return Object.freeze({
            absolutePath,
            bytes: content.byteLength,
            sha256: createHash('sha256').update(content).digest('hex'),
        });
    } catch {
        throw new Error('Xtream artifact path is not exclusively writable');
    }
}

function invalid(): never {
    throw new Error('invalid');
}
