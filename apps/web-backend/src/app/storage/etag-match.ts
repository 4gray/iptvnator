/**
 * Weak comparison of an `If-None-Match` or `If-Match` header with the
 * current ETag (RFC 9110 requires it for `If-None-Match` on GET). nginx
 * weakens the ETag of a gzipped response (`W/"…"`), so clients send the
 * weak form back; the server's tags are revisions, so weak equality is
 * enough to detect a conflict. `*` matches any tag; a route that needs an
 * explicit revision rejects it itself.
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
