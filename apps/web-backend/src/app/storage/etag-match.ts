/**
 * Weak comparison of an `If-None-Match` header with the current ETag, as
 * RFC 9110 requires for GET. nginx weakens the ETag of a gzipped response
 * (`W/"…"`), so clients send the weak form back.
 */
export function matchesEtag(
    ifNoneMatch: string | undefined,
    etag: string
): boolean {
    if (!ifNoneMatch) {
        return false;
    }
    const current = stripWeak(etag);
    return ifNoneMatch
        .split(',')
        .map((tag) => tag.trim())
        .some((tag) => tag === '*' || stripWeak(tag) === current);
}

function stripWeak(tag: string): string {
    return tag.startsWith('W/') ? tag.slice(2) : tag;
}
