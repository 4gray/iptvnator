import { Duplex, PassThrough, Readable, pipeline } from 'stream';
import { createGunzip } from 'zlib';
import * as xzDecompressModule from 'xz-decompress';

/**
 * `xz-decompress` ships a UMD bundle whose stream class is reachable either as
 * a named export or nested under `default`, depending on the module interop of
 * the consumer (bundler, ts-jest, or raw ESM). Resolve it defensively.
 */
type XzModuleShape = {
    XzReadableStream?: typeof import('xz-decompress').XzReadableStream;
    default?: {
        XzReadableStream?: typeof import('xz-decompress').XzReadableStream;
    };
};
const xzModule = xzDecompressModule as unknown as XzModuleShape;
const XzReadableStream =
    xzModule.XzReadableStream ?? xzModule.default?.XzReadableStream;

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const XZ_MAGIC = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);

/**
 * Resolve the ambiguous file-level compression case after HTTP decoding.
 *
 * Sniffs the leading bytes and transparently decompresses a gzip (`.gz`) or
 * xz (`.xz`) EPG file, passing anything else through untouched. Only one file
 * layer is unwrapped; invalid gzip/xz remains an error.
 */
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

/**
 * Bridge the WHATWG stream exposed by `xz-decompress` back into a Node stream
 * so it can take part in the existing pipeline.
 */
function createXzDecodeStream(source: Readable): Readable {
    if (typeof XzReadableStream !== 'function') {
        throw new Error(
            'Cannot decompress xz EPG source: xz-decompress failed to load'
        );
    }
    // xz-decompress types its stream as the DOM `ReadableStream`, while Node's
    // `Readable.to/fromWeb` use the structurally identical `stream/web` type.
    // Bridge across the two type worlds explicitly.
    const webSource = Readable.toWeb(
        source
    ) as unknown as ReadableStream<Uint8Array>;
    const decompressed = new XzReadableStream(webSource);
    return Readable.fromWeb(
        decompressed as unknown as Parameters<typeof Readable.fromWeb>[0]
    );
}

async function decodeRemainingFile(
    input: Readable,
    output: PassThrough
): Promise<void> {
    const iterator = input.iterator({ destroyOnReturn: false });
    // Six bytes covers both the gzip (2) and xz (6) signatures.
    const prefix = Buffer.alloc(XZ_MAGIC.length);
    const pending: Buffer[] = [];
    let prefixLength = 0;

    // Retain only the chunks needed to read the signature, never the whole file.
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

    const isGzip =
        prefixLength >= GZIP_MAGIC.length &&
        prefix.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC);
    const isXz = prefixLength >= XZ_MAGIC.length && prefix.equals(XZ_MAGIC);

    // One optional file layer only. Invalid gzip/xz remains an error.
    if (isXz) {
        pipeline(createXzDecodeStream(replay), output, (error) => {
            if (error) output.destroy(error);
        });
        return;
    }

    const decoder = isGzip ? createGunzip() : new PassThrough();
    pipeline(replay, decoder, output, (error) => {
        if (error) output.destroy(error);
    });
}
