import { randomBytes } from 'crypto';
import { PassThrough, Readable, pipeline } from 'stream';
import { finished } from 'stream/promises';
import { brotliCompressSync, deflateSync, gzipSync } from 'zlib';
import { createOptionalEpgGunzip } from './epg-optional-gunzip';
import { createDecodedEpgStream } from './epg-stream-decoder';
import { StreamingEpgParser } from './epg-streaming-parser';

const xmltvFixture =
    '<?xml version="1.0" encoding="utf-8" ?>' +
    '<tv><channel id="test"><display-name>Test Channel</display-name></channel>' +
    '<programme channel="test" start="20260912090000 +0000" stop="20260912100000 +0000">' +
    '<title>Test Bulletin</title></programme></tv>';

async function collectDecodedText(stream: Readable): Promise<string> {
    return (await collectDecodedBytes(stream)).toString('utf-8');
}

async function collectDecodedBytes(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

function optionalFileStream(source: Readable): Readable {
    const output = new PassThrough();
    pipeline(source, createOptionalEpgGunzip(), output, (error) => {
        if (error) output.destroy(error);
    });
    return output;
}

function parseChannelCount(xml: string): number {
    const parser = new StreamingEpgParser(
        () => undefined,
        () => undefined,
        () => undefined
    );

    parser.write(xml);
    return parser.finish().totalChannels;
}

describe('createDecodedEpgStream', () => {
    it.each([
        ['gzip file', gzipSync(xmltvFixture), {}, true],
        [
            'HTTP deflate',
            deflateSync(xmltvFixture),
            { 'content-encoding': 'deflate' },
            false,
        ],
        [
            'deflate over gzip file',
            deflateSync(gzipSync(xmltvFixture)),
            { 'content-encoding': 'deflate' },
            true,
        ],
        [
            'gzip then Brotli over gzip file',
            brotliCompressSync(gzipSync(gzipSync(xmltvFixture))),
            { 'content-encoding': 'gzip, br' },
            true,
        ],
        [
            'gzip then Brotli over XML',
            brotliCompressSync(gzipSync(xmltvFixture)),
            { 'content-encoding': 'gzip, br' },
            true,
        ],
        [
            'two declared HTTP gzip layers over XML',
            gzipSync(gzipSync(xmltvFixture)),
            { 'content-encoding': 'gzip, gzip' },
            true,
        ],
    ] as const)(
        'preserves %s decoding',
        async (_name, payload, headers, fileHint) => {
            const decodedText = await collectDecodedText(
                createDecodedEpgStream(
                    Readable.from([payload]),
                    headers,
                    fileHint
                )
            );
            expect(decodedText).toBe(xmltvFixture);
            expect(parseChannelCount(decodedText)).toBe(1);
        }
    );

    it('does not unwrap an unadvertised file or recursively unwrap file layers', async () => {
        for (const [layers, hint] of [
            [2, false],
            [3, true],
        ] as const) {
            let payload: Buffer = Buffer.from(xmltvFixture);
            for (let i = 0; i < layers; i++) payload = gzipSync(payload);
            const result = await collectDecodedBytes(
                createDecodedEpgStream(
                    Readable.from([payload]),
                    { 'content-encoding': 'gzip' },
                    hint
                )
            );
            expect(result).toEqual(gzipSync(xmltvFixture));
        }
    });

    it('decodes a gzip file inside HTTP gzip before XMLTV parsing (#1586)', async () => {
        const decodedText = await collectDecodedText(
            createDecodedEpgStream(
                Readable.from([gzipSync(gzipSync(xmltvFixture))]),
                { 'content-encoding': 'gzip' },
                true
            )
        );

        expect(decodedText).toBe(xmltvFixture);
        const channels = jest.fn();
        const programs = jest.fn();
        const parser = new StreamingEpgParser(
            channels,
            programs,
            () => undefined
        );
        parser.write(decodedText);
        expect(parser.finish()).toEqual({ totalChannels: 1, totalPrograms: 1 });
        expect(channels).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'test' }),
        ]);
        expect(programs).toHaveBeenCalledWith([
            expect.objectContaining({
                title: [{ lang: '', value: 'Test Bulletin' }],
            }),
        ]);
    });

    it('decodes Brotli transfer-encoded XML before SAX parsing', async () => {
        const decodedText = await collectDecodedText(
            createDecodedEpgStream(
                Readable.from([brotliCompressSync(xmltvFixture)]),
                { 'content-encoding': 'br' },
                false
            )
        );

        expect(decodedText.startsWith('<?xml')).toBe(true);
        expect(parseChannelCount(decodedText)).toBe(1);
    });

    it('decodes gzip transfer-encoded XML before SAX parsing', async () => {
        const decodedText = await collectDecodedText(
            createDecodedEpgStream(
                Readable.from([gzipSync(xmltvFixture)]),
                { 'content-encoding': 'gzip' },
                false
            )
        );

        expect(decodedText.startsWith('<?xml')).toBe(true);
        expect(parseChannelCount(decodedText)).toBe(1);
    });

    it('keeps plain XML readable when no transfer encoding is present', async () => {
        const decodedText = await collectDecodedText(
            createDecodedEpgStream(
                Readable.from([Buffer.from(xmltvFixture)]),
                {},
                false
            )
        );

        expect(decodedText.startsWith('<?xml')).toBe(true);
        expect(parseChannelCount(decodedText)).toBe(1);
    });

    it('decodes gzip XML payloads after transfer decoding', async () => {
        const transferEncodedPayload = brotliCompressSync(
            gzipSync(xmltvFixture)
        );

        const decodedText = await collectDecodedText(
            createDecodedEpgStream(
                Readable.from([transferEncodedPayload]),
                { 'content-encoding': 'br' },
                true
            )
        );

        expect(decodedText.startsWith('<?xml')).toBe(true);
        expect(parseChannelCount(decodedText)).toBe(1);
    });

    it('does not double-gunzip mislabelled gzip XML payloads', async () => {
        const decodedText = await collectDecodedText(
            createDecodedEpgStream(
                Readable.from([gzipSync(xmltvFixture)]),
                { 'content-encoding': 'gzip' },
                true
            )
        );

        expect(decodedText.startsWith('<?xml')).toBe(true);
        expect(parseChannelCount(decodedText)).toBe(1);
    });

    it('decodes multi-value content-encoding in reverse order', async () => {
        const encodedPayload = brotliCompressSync(gzipSync(xmltvFixture));

        const decodedText = await collectDecodedText(
            createDecodedEpgStream(
                Readable.from([encodedPayload]),
                { 'content-encoding': 'gzip, br' },
                false
            )
        );

        expect(decodedText.startsWith('<?xml')).toBe(true);
        expect(parseChannelCount(decodedText)).toBe(1);
    });

    it('destroys the source stream when a decoder fails', async () => {
        const source = new PassThrough();
        const decodedStream = createDecodedEpgStream(
            source,
            { 'content-encoding': 'gzip' },
            false
        );

        const readPromise = collectDecodedText(decodedStream);
        source.end(Buffer.from('not gzip'));

        await expect(readPromise).rejects.toThrow();
        expect(source.destroyed).toBe(true);
    });

    it.each(['invalid', 'truncated'] as const)(
        'rejects %s inner gzip',
        async (kind) => {
            const inner =
                kind === 'invalid'
                    ? Buffer.from([0x1f, 0x8b, 0xff, 0, 0, 0, 0, 0, 0, 0])
                    : gzipSync(xmltvFixture).subarray(0, -4);
            const source = new PassThrough();
            const output = createDecodedEpgStream(
                source,
                { 'content-encoding': 'gzip' },
                true
            );
            const collected = collectDecodedBytes(output);
            // A bad header must close even a source that has not ended yet.
            if (kind === 'invalid') source.write(gzipSync(inner));
            else source.end(gzipSync(inner));
            await expect(collected).rejects.toThrow();
            expect(source.destroyed).toBe(true);
            expect(output.destroyed).toBe(true);
        }
    );

    it('stops the entire decoding chain when the consumer closes early', async () => {
        const source = new PassThrough();
        const output = createDecodedEpgStream(
            source,
            { 'content-encoding': 'gzip' },
            true
        );
        const sourceClosed = finished(source).catch((error: Error) => error);
        const iterator = output[Symbol.asyncIterator]();
        source.write(gzipSync(gzipSync(Buffer.alloc(256 * 1024, 0x61))));
        expect((await iterator.next()).done).toBe(false);
        await iterator.return?.();
        expect(await sourceClosed).toHaveProperty('message');
        expect(source.destroyed).toBe(true);
        expect(output.destroyed).toBe(true);
    });

    it('preserves bytes and bounds read-ahead with a slow consumer', async () => {
        const expected = randomBytes(1024 * 1024);
        const encoded = gzipSync(gzipSync(expected));
        let bytesRead = 0;
        const source = Readable.from(
            (function* () {
                for (let i = 0; i < encoded.length; i += 1024) {
                    const chunk = encoded.subarray(i, i + 1024);
                    bytesRead += chunk.length;
                    yield chunk;
                }
            })(),
            { objectMode: false, highWaterMark: 1024 }
        );
        const output = createDecodedEpgStream(
            source,
            { 'content-encoding': 'gzip' },
            true
        );
        const chunks: Buffer[] = [];
        for await (const chunk of output) {
            chunks.push(chunk);
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (chunks.length === 1)
                expect(bytesRead).toBeLessThan(encoded.length);
        }
        expect(Buffer.concat(chunks)).toEqual(expected);
    });
});

describe('optional EPG file layer', () => {
    it('waits for the second signature byte delivered in a later turn', async () => {
        const payload = gzipSync(xmltvFixture);
        const source = Readable.from(
            (async function* () {
                yield payload.subarray(0, 1);
                await new Promise<void>((resolve) => setImmediate(resolve));
                yield payload.subarray(1, 2);
                await new Promise<void>((resolve) => setImmediate(resolve));
                yield payload.subarray(2);
            })()
        );
        expect(await collectDecodedText(optionalFileStream(source))).toBe(
            xmltvFixture
        );
    });

    it.each([
        ['gzip', gzipSync(xmltvFixture), Buffer.from(xmltvFixture)],
        ['plain XML', Buffer.from(xmltvFixture), Buffer.from(xmltvFixture)],
        ['empty', Buffer.alloc(0), Buffer.alloc(0)],
        ['one byte', Buffer.from([0x1f]), Buffer.from([0x1f])],
        [
            'non-gzip prefix',
            Buffer.from([0x1f, 0x00, 0x80]),
            Buffer.from([0x1f, 0x00, 0x80]),
        ],
    ] as const)(
        'handles split %s prefixes and empty chunks without losing bytes',
        async (_name, payload, expected) => {
            const source = Readable.from([
                Buffer.alloc(0),
                payload.subarray(0, 1),
                Buffer.alloc(0),
                payload.subarray(1, 2),
                Buffer.alloc(0),
                payload.subarray(2),
            ]);
            expect(
                await collectDecodedBytes(optionalFileStream(source))
            ).toEqual(expected);
        }
    );

    it.each([
        Buffer.alloc(0),
        Buffer.from([0x1f]),
        gzipSync(xmltvFixture).subarray(0, 10),
    ])(
        'propagates source errors while waiting for a prefix or compressed body (%j)',
        async (prefix) => {
            const source = new PassThrough();
            const output = optionalFileStream(source);
            const collected = collectDecodedBytes(output);
            source.write(prefix);
            await new Promise<void>((resolve) => setImmediate(resolve));
            source.destroy(new Error('upstream failed'));
            await expect(collected).rejects.toThrow('upstream failed');
            expect(output.destroyed).toBe(true);
        }
    );

    it.each([
        Buffer.alloc(0),
        Buffer.from([0x1f]),
        gzipSync(xmltvFixture).subarray(0, 10),
    ])(
        'closes a pending prefix/body read when the consumer aborts (%j)',
        async (prefix) => {
            const source = new PassThrough();
            const output = optionalFileStream(source);
            const sourceClosed = finished(source).catch(
                (error: Error) => error
            );
            const outputClosed = finished(output).catch(
                (error: Error) => error
            );
            source.write(prefix);
            await new Promise<void>((resolve) => setImmediate(resolve));
            output.destroy(new Error('consumer stopped'));
            expect(await outputClosed).toEqual(new Error('consumer stopped'));
            expect(await sourceClosed).toHaveProperty('message');
            expect(source.destroyed).toBe(true);
        }
    );
});
