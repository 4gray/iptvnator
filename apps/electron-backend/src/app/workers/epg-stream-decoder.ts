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
        transforms.push(
            contentEncodings.includes('gzip')
                ? createOptionalEpgGunzip()
                : createGunzip()
        );
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
