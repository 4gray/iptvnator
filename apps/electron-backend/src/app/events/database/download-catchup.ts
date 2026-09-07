import type { CatchupDownloadMetadata } from '@iptvnator/shared/interfaces';

export function validateCatchupDownload(
    value: CatchupDownloadMetadata | null | undefined,
    url: string,
    now = Math.floor(Date.now() / 1000)
): CatchupDownloadMetadata {
    if (
        !value ||
        typeof value.channelName !== 'string' ||
        !Number.isSafeInteger(value.startTimestamp) ||
        value.startTimestamp <= 0 ||
        !Number.isSafeInteger(value.stopTimestamp) ||
        value.stopTimestamp <= value.startTimestamp ||
        value.stopTimestamp > now
    ) {
        throw new Error('Only completed archive programmes can be downloaded');
    }
    if (
        value.expiresAt !== undefined &&
        (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now)
    ) {
        throw new Error('This programme is no longer available in the archive');
    }
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('Invalid archive URL');
    }
    if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        /\.m3u8$/i.test(parsed.pathname) ||
        [...parsed.searchParams.values()].some((v) => /^m3u8$/i.test(v))
    ) {
        throw new Error('Archive downloads currently require a TS stream');
    }
    return value;
}

export function catchupForDownload(item: {
    contentType: string;
    catchup?: CatchupDownloadMetadata | null;
    url: string;
}): CatchupDownloadMetadata | undefined {
    return item.contentType === 'catchup'
        ? validateCatchupDownload(item.catchup, item.url)
        : undefined;
}
