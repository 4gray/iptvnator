import { Duplex, PassThrough, Readable, Transform, pipeline } from 'stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'zlib';
import {
    EpgResponseContentEncoding,
    getEpgResponseContentEncodings,
    HeaderReader,
} from './epg-response-utils';
import { createOptionalEpgGunzip } from './epg-optional-gunzip';

function createContentEncodingDecoder(
    contentEncoding: EpgResponseContentEncoding
): Transform {
    switch (contentEncoding) {
        case 'br':
            return createBrotliDecompress();
        case 'gzip':
            return createGunzip();
        case 'deflate':
            return createInflate();
    }
}

export function createDecodedEpgStream(
    source: Readable,
    headers: HeaderReader,
    shouldGunzipPayload: boolean
): Readable {
    const contentEncodings = getEpgResponseContentEncodings(headers);
    const transforms: Duplex[] = contentEncodings.map(
        createContentEncodingDecoder
    );

    if (shouldGunzipPayload) {
        // The byte-sniffing decompressor handles a gzip (.gz) or xz (.xz) EPG
        // file and passes an already-decoded payload through untouched.
        transforms.push(createOptionalEpgGunzip());
    }

    if (transforms.length === 0) {
        return source;
    }

    const output = new PassThrough();
    pipeline([source, ...transforms, output], (error) => {
        if (error) {
            output.destroy(error);
        }
    });

    return output;
}
