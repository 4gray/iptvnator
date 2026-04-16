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

/**
 * Detect whether an EPG response should be gunzipped.
 * Some providers redirect plain-looking URLs to a `.gz` payload.
 */
export function shouldGunzipEpgResponse(
    originalUrl: string,
    response: { headers: Headers; url?: string }
): boolean {
    if (hasGzipPath(originalUrl) || hasGzipPath(response.url)) {
        return true;
    }

    const contentType = response.headers.get('content-type');
    if (
        contentType &&
        /(application\/gzip|application\/x-gzip)/i.test(contentType)
    ) {
        return true;
    }

    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition?.toLowerCase().includes('.gz')) {
        return true;
    }

    return false;
}
