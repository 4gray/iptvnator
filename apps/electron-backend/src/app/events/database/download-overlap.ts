import { open } from 'node:fs/promises';
import { Transform } from 'node:stream';

/**
 * Bytes re-requested before the retained partial's end when resuming without
 * an ETag/Last-Modified validator. The re-sent window must match the tail of
 * the partial byte-for-byte before anything is appended — a self-made
 * validator for servers that provide none: two different encodes of the same
 * movie cannot plausibly share a 256 KiB window at an arbitrary offset.
 */
export const OVERLAP_VERIFICATION_BYTES = 262_144;

/**
 * The re-sent overlap differed from the retained partial's tail, so the
 * server is serving a different representation and the partial must be
 * discarded. Raised before any mismatching byte reaches the file.
 */
export class OverlapMismatchError extends Error {
    constructor() {
        super('Retained partial does not match the server content');
    }
}

/**
 * Compares the first `expected.length` streamed bytes against the retained
 * partial's tail and consumes them; only bytes past the overlap flow through
 * to the file. A mismatch fails the pipeline with OverlapMismatchError.
 * A stream that ends inside the overlap is NOT a mismatch — nothing was
 * appended, and the caller's short-transfer handling owns that case.
 */
export function createOverlapVerifier(expected: Buffer): Transform {
    let verifiedBytes = 0;
    return new Transform({
        transform(chunk: Buffer | string, _encoding, callback) {
            let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (verifiedBytes < expected.length) {
                const overlap = data.subarray(
                    0,
                    Math.min(expected.length - verifiedBytes, data.length)
                );
                const matches = overlap.equals(
                    expected.subarray(
                        verifiedBytes,
                        verifiedBytes + overlap.length
                    )
                );
                if (!matches) {
                    callback(new OverlapMismatchError());
                    return;
                }
                verifiedBytes += overlap.length;
                data = data.subarray(overlap.length);
            }
            callback(null, data.length > 0 ? data : undefined);
        },
    });
}

/** Reads `[start, start + length)` of the partial file into a buffer. */
export async function readPartialTail(
    partialPath: string,
    start: number,
    length: number
): Promise<Buffer> {
    const handle = await open(partialPath, 'r');
    try {
        const buffer = Buffer.alloc(length);
        let filled = 0;
        while (filled < length) {
            const { bytesRead } = await handle.read(
                buffer,
                filled,
                length - filled,
                start + filled
            );
            if (bytesRead === 0) {
                throw new Error('Partial download shrank during resume');
            }
            filled += bytesRead;
        }
        return buffer;
    } finally {
        await handle.close();
    }
}
