export type HeaderReader =
    | Record<string, unknown>
    | {
          get(name: string): unknown;
      };

export type EpgResponseContentEncoding = 'br' | 'gzip' | 'deflate';

const SUPPORTED_CONTENT_ENCODINGS: readonly EpgResponseContentEncoding[] = [
    'br',
    'gzip',
    'deflate',
];

function getHeaderValue(headers: HeaderReader, name: string): string | null {
    const value =
        'get' in headers && typeof headers.get === 'function'
            ? headers.get(name)
            : Object.entries(headers).find(
                  ([headerName]) =>
                      headerName.toLowerCase() === name.toLowerCase()
              )?.[1];
    return value === null || value === undefined ? null : String(value);
}

function hasGzipPath(url: string | null | undefined): boolean {
    if (!url) {
        return false;
    }

    try {
        return new URL(url).pathname.toLowerCase().endsWith('.gz');
    } catch {
        return url.toLowerCase().endsWith('.gz');
    }
}

export function getEpgResponseContentEncoding(
    headers: HeaderReader
): EpgResponseContentEncoding | null {
    const contentEncoding = getEpgResponseContentEncodings(headers).at(0);

    return contentEncoding ?? null;
}

export function getEpgResponseContentEncodings(
    headers: HeaderReader
): EpgResponseContentEncoding[] {
    return (
        getHeaderValue(headers, 'content-encoding')
            ?.toLowerCase()
            .split(',')
            .map((encoding) => encoding.trim())
            .filter((encoding): encoding is EpgResponseContentEncoding =>
                SUPPORTED_CONTENT_ENCODINGS.includes(
                    encoding as EpgResponseContentEncoding
                )
            )
            .reverse() ?? []
    );
}

/**
 * Detect whether an EPG response should be gunzipped.
 * Some providers redirect plain-looking URLs to a `.gz` payload.
 */
export function shouldGunzipEpgResponse(
    originalUrl: string,
    response: { headers: HeaderReader; url?: string }
): boolean {
    if (hasGzipPath(originalUrl) || hasGzipPath(response.url)) {
        return true;
    }

    const contentType = getHeaderValue(response.headers, 'content-type');
    if (
        contentType &&
        /(application\/gzip|application\/x-gzip)/i.test(contentType)
    ) {
        return true;
    }

    const contentDisposition = getHeaderValue(
        response.headers,
        'content-disposition'
    );
    if (contentDisposition?.toLowerCase().includes('.gz')) {
        return true;
    }

    return false;
}
