export function isBrowserAccessFailure(details: string): boolean {
    return (
        details.includes('cors') ||
        details.includes('cross-origin') ||
        details.includes('cross origin') ||
        details.includes('access-control') ||
        details.includes('access control') ||
        details.includes('content security policy') ||
        details.includes('mixed content') ||
        details.includes('private network access') ||
        details.includes('blocked by content security') ||
        details.includes('blocked by cors') ||
        details.includes('blocked by mixed content') ||
        details.includes('not allowed to load local resource') ||
        details.includes('err_blocked') ||
        details.includes('err_cleartext')
    );
}
