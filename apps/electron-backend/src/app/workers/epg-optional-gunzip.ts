import { Duplex, PassThrough, Readable, pipeline } from 'stream';
import { createGunzip } from 'zlib';

/** Resolve the ambiguous .gz + HTTP gzip case after HTTP decoding. */
export function createOptionalEpgGunzip(): Duplex {
    const input = new PassThrough();
    const output = new PassThrough();
    // Joining both ends makes decoder errors/consumer closure interrupt even
    // an outstanding prefix/body read, rather than waiting for the next chunk.
    const stage = Duplex.from({ writable: input, readable: output });
    void decodeRemainingFile(input, output).catch((error: Error) => {
        stage.destroy(error);
    });
    return stage;
}

async function decodeRemainingFile(
    input: Readable,
    output: PassThrough
): Promise<void> {
    const iterator = input.iterator({ destroyOnReturn: false });
    const prefix = Buffer.alloc(2);
    const pending: Buffer[] = [];
    let prefixLength = 0;

    // Retain at most two non-empty chunks, never the whole response.
    while (prefixLength < prefix.length) {
        const next = await iterator.next();
        if (next.done) break;
        if (next.value.length === 0) continue;
        pending.push(next.value);
        prefixLength += next.value.copy(prefix, prefixLength);
    }

    const replay = Readable.from(
        (async function* () {
            try {
                yield* pending;
                yield* iterator;
            } finally {
                await iterator.return?.();
            }
        })(),
        { objectMode: false }
    );
    // One optional file layer only. Invalid gzip remains an error.
    const decoder =
        prefixLength === 2 && prefix[0] === 0x1f && prefix[1] === 0x8b
            ? createGunzip()
            : new PassThrough();
    pipeline(replay, decoder, output, (error) => {
        if (error) output.destroy(error);
    });
}
