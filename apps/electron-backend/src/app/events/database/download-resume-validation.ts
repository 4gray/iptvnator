import type { ReservedPartialDownloadFile } from './download-file-path';

/**
 * Validates the response to a resume request. Returns the offset the transfer
 * may append from: the requested offset for a correct `206`, or zero when the
 * server ignored `Range` (or `If-Range` detected a changed entity) and the
 * transfer must restart over the same `.part`.
 */
export function validateResumeResponse(
    reservation: ReservedPartialDownloadFile,
    status: number,
    headers: unknown,
    resumeOffset: number
): number {
    if (resumeOffset === 0) {
        return 0;
    }

    if (status !== 206) {
        // Either the server ignored Range or If-Range detected that the
        // remote entity changed. The retained partial is unusable either way,
        // so restart from byte zero instead of failing the download.
        console.warn(
            `[Downloads] Restarting ${reservation.filename} from the beginning (resume request answered with HTTP ${status})`
        );
        return 0;
    }

    const contentRange = getHeaderValue(
        headers as Record<string, unknown>,
        'content-range'
    );
    const start = contentRange?.match(/^bytes\s+(\d+)-/i)?.[1];
    if (start === undefined || Number(start) !== resumeOffset) {
        throw new Error('Server returned an invalid resume range');
    }
    return resumeOffset;
}

export function getResponseValidator(headers: unknown): string | null {
    const headerMap = headers as Record<string, unknown>;
    const etag = getHeaderValue(headerMap, 'etag');
    // If-Range only accepts strong validators, so skip weak W/ ETags.
    if (etag && !etag.startsWith('W/')) {
        return etag;
    }
    return getHeaderValue(headerMap, 'last-modified') ?? null;
}

export function getTotalBytes(
    headers: unknown,
    resumeOffset: number
): number | null {
    const headerMap = headers as Record<string, unknown>;
    const contentRange = getHeaderValue(headerMap, 'content-range');
    if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        // An indeterminate total (`bytes 200-299/*`) means the representation
        // length is unknown; Content-Length then describes only the selected
        // range, and deriving a "total" from it would declare the transfer
        // complete at the end of that range.
        return match ? Number(match[1]) : null;
    }

    const contentLength = getHeaderValue(headerMap, 'content-length');
    if (!contentLength) {
        return null;
    }

    const parsed = Number(contentLength);
    return Number.isFinite(parsed) ? resumeOffset + parsed : null;
}

/**
 * End (exclusive) of an indeterminate range: `Content-Range: bytes 200-299/*`
 * yields 300. The entity provably extends at least this far even though its
 * total is withheld, so a response ending earlier is short and one delivering
 * its full range is complete BY ITS OWN evidence.
 */
export function getIndeterminateRangeEnd(headers: unknown): number | null {
    const contentRange = getHeaderValue(
        headers as Record<string, unknown>,
        'content-range'
    );
    const match = contentRange?.match(/^bytes\s+\d+-(\d+)\/\*$/i);
    return match ? Number(match[1]) + 1 : null;
}

// Total from a 416's `Content-Range: bytes */N`. A compliant server states
// the current representation length when refusing a range; equal to the
// partial's size it CONFIRMS the file is complete rather than shrunk.
export function getUnsatisfiedRangeTotal(headers: unknown): number | null {
    if (!headers || typeof headers !== 'object') {
        return null;
    }
    const contentRange = getHeaderValue(
        headers as Record<string, unknown>,
        'content-range'
    );
    const match = contentRange?.match(/^bytes\s+\*\/(\d+)$/i);
    return match ? Number(match[1]) : null;
}

function getHeaderValue(
    headers: Record<string, unknown>,
    name: string
): string | undefined {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(value)) {
        return value.length > 0 ? String(value[0]) : undefined;
    }
    return value === undefined ? undefined : String(value);
}
