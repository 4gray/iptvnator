import { PassThrough, Readable, Transform, pipeline } from 'stream';
import {
    createBrotliDecompress,
    createGunzip,
    createInflate,
} from 'zlib';
import {
    EpgResponseContentEncoding,
    getEpgResponseContentEncodings,
    HeaderReader,
} from './epg-response-utils';

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
    const transforms = contentEncodings.map(createContentEncodingDecoder);

    if (shouldGunzipPayload && !contentEncodings.includes('gzip')) {
        transforms.push(createGunzip());
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
