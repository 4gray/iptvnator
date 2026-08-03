export function isBrowserMediaTypeSupported(
    mimeType: string
): boolean | undefined {
    if (typeof MediaSource === 'undefined') {
        return undefined;
    }

    try {
        const probe: unknown = MediaSource.isTypeSupported;
        return typeof probe === 'function'
            ? probe.call(MediaSource, mimeType)
            : undefined;
    } catch {
        return undefined;
    }
}
