/** Tuple encoding prevents delimiter/prefix collisions between accounts. */
export function portalIdentityKey(username: string, password: string): string {
    return JSON.stringify([username, password]);
}

export function detailCacheKey(
    username: string,
    password: string,
    itemId: number
): string {
    return `${portalIdentityKey(username, password)}:${itemId}`;
}

export function clearAccountDetails(
    cache: Map<string, unknown>,
    identityKey: string
): void {
    for (const key of cache.keys()) {
        if (key.startsWith(`${identityKey}:`)) cache.delete(key);
    }
}
