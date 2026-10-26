/**
 * Convert relative URLs to absolute URLs using the portal base URL
 * Handles screenshot_uri and cmd paths that come as relative from the server
 */
export function makeAbsoluteUrl(baseUrl: string, relativePath: string): string {
    if (!relativePath) return '';
    // Already absolute URL
    if (
        relativePath.startsWith('http://') ||
        relativePath.startsWith('https://')
    ) {
        return relativePath;
    }
    // Parse the base URL to get origin
    try {
        const url = new URL(baseUrl);
        // Ensure the relative path starts with /
        const path = relativePath.startsWith('/')
            ? relativePath
            : `/${relativePath}`;
        return `${url.origin}${path}`;
    } catch {
        return relativePath;
    }
}

/** Artwork uses portal-root paths; reject non-HTTP schemes and blank placeholders. */
export function resolveStalkerArtwork(
    base: string,
    ...candidates: unknown[]
): string | undefined {
    for (const value of candidates) {
        if (
            typeof value !== 'string' ||
            !value.trim() ||
            /^(n\/a|null|undefined)$/i.test(value.trim())
        )
            continue;
        try {
            const raw = value.trim();
            if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw))
                continue;
            const url = new URL(
                raw.startsWith('//')
                    ? new URL(base).protocol + raw
                    : makeAbsoluteUrl(base, raw)
            );
            if (
                /^https?:$/.test(url.protocol) &&
                !url.username &&
                !url.password
            )
                return url.href;
        } catch {
            /* Try the provider's next artwork field. */
        }
    }
    return undefined;
}
