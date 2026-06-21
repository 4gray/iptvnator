import { PassThrough, Readable } from 'stream';
import { brotliCompressSync, gzipSync } from 'zlib';
import { createDecodedEpgStream } from './epg-stream-decoder';
import { StreamingEpgParser } from './epg-streaming-parser';

const xmltvFixture =
    '<?xml version="1.0" encoding="utf-8" ?>' +
    '<tv><channel id="test"><display-name>Test Channel</display-name></channel></tv>';

async function collectDecodedText(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf-8');
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
});
