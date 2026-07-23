import type { ScheduleRecordingRequest } from '@iptvnator/shared/interfaces';

export function buildRecordingRequestHeaders(
    request: ScheduleRecordingRequest
): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [rawName, rawValue] of Object.entries(
        request.playback.headers ?? {}
    )) {
        const name = rawName.trim();
        const value = String(rawValue).trim();
        assertSafeHttpHeader(name, value);
        if (!hasHeader(headers, name)) {
            headers[name] = value;
        }
    }
    addHeaderFallback(headers, 'User-Agent', request.playback.userAgent);
    addHeaderFallback(headers, 'Referer', request.playback.referer);
    addHeaderFallback(headers, 'Origin', request.playback.origin);
    return headers;
}

function addHeaderFallback(
    headers: Record<string, string>,
    name: string,
    rawValue?: string
): void {
    const value = rawValue?.trim();
    if (!value || hasHeader(headers, name)) {
        return;
    }
    assertSafeHttpHeader(name, value);
    headers[name] = value;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
    const normalizedName = name.toLowerCase();
    return Object.keys(headers).some(
        (candidate) => candidate.toLowerCase() === normalizedName
    );
}

function assertSafeHttpHeader(name: string, value: string): void {
    if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        !value ||
        /[\r\n\0]/.test(value)
    ) {
        throw new Error(`Invalid recording HTTP header: ${name}`);
    }
}
