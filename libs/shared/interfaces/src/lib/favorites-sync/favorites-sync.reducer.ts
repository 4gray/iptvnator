import type {
    FavoriteState,
    FavoriteOperation,
    FavoriteResult,
} from './favorites-sync.contract';
import {
    assertFavoriteState,
    parseFavoriteOperation,
} from './favorites-sync.validation';
export const emptyFavoriteState = (): FavoriteState => ({
    revision: 0,
    member: false,
});
/** Stale same-item changes require a choice; absent rows are never remove operations. */
export function applyFavoriteOperation(
    state: FavoriteState,
    input: FavoriteOperation
): FavoriteResult {
    assertFavoriteState(state);
    const operation = parseFavoriteOperation(input);
    if (operation.expectedRevision !== state.revision)
        return { status: 'conflict', state };
    if (!Number.isSafeInteger(state.revision + 1))
        throw new Error('Favorite revision exhausted');
    return {
        status: 'applied',
        state: {
            revision: state.revision + 1,
            member: operation.member,
            ...((operation.snapshot ?? state.snapshot)
                ? { snapshot: operation.snapshot ?? state.snapshot }
                : {}),
        },
    };
}
/** Exact URL bytes retain the historical URL membership, including duplicate catalog rows. */
export async function m3uFavoriteReference(url: string) {
    if (!url) throw new Error('Missing favorite URL');
    const bytes = new TextEncoder().encode(url);
    const hash = crypto.subtle
        ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
        : (await import('@noble/hashes/sha2.js')).sha256(bytes);
    return {
        provider: 'm3u' as const,
        version: 1 as const,
        urlHash: Array.from(new Uint8Array(hash), (byte) =>
            byte.toString(16).padStart(2, '0')
        ).join(''),
    };
}
/** HTTP pages must have the fallback loaded before accepting an offline edit. */
export async function prepareFavoriteHash(): Promise<void> {
    if (!crypto.subtle) await import('@noble/hashes/sha2.js');
}
