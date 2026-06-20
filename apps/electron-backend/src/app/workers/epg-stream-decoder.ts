import { Readable, Transform } from 'stream';
import {
    createBrotliDecompress,
    createGunzip,
    createInflate,
} from 'zlib';
import {
    getEpgResponseContentEncoding,
    HeaderReader,
} from './epg-response-utils';

function createContentEncodingDecoder(
    contentEncoding: ReturnType<typeof getEpgResponseContentEncoding>
): Transform | null {
    switch (contentEncoding) {
        case 'br':
            return createBrotliDecompress();
        case 'gzip':
            return createGunzip();
        case 'deflate':
            return createInflate();
        default:
            return null;
    }
}

export function createDecodedEpgStream(
    source: Readable,
    headers: HeaderReader,
    shouldGunzipPayload: boolean
): Readable {
    const transforms: Transform[] = [];
    const contentEncoding = getEpgResponseContentEncoding(headers);
    const contentEncodingDecoder =
        createContentEncodingDecoder(contentEncoding);

    if (contentEncodingDecoder) {
        transforms.push(contentEncodingDecoder);
    }

    if (shouldGunzipPayload) {
        transforms.push(createGunzip());
    }

    if (transforms.length === 0) {
        return source;
    }

    const decodedStream = transforms.reduce<Readable>(
        (stream, transform) => stream.pipe(transform),
        source
    );

    for (const stream of [source, ...transforms]) {
        if (stream !== decodedStream) {
            stream.on('error', (error) => decodedStream.destroy(error));
        }
    }

    return decodedStream;
}
