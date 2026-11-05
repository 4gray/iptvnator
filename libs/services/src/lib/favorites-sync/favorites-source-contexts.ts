import type { FavoritesSyncClient } from './favorites-sync-client';
import { createRandomId } from '@iptvnator/shared/interfaces';

const RETIRED = 'iptvnator-favorites-source-retired';
export const favoriteSourceContextsKey = (instanceId: string) =>
    `iptvnator-server:${instanceId}:favorites-contexts-v1`;

function removeCachedContext(instanceId: string, sourceId: string): void {
    const key = favoriteSourceContextsKey(instanceId);
    const raw = localStorage.getItem(key);
    if (raw !== null) {
        const saved: unknown = JSON.parse(raw);
        if (!Array.isArray(saved))
            throw new Error('Favorite context storage unavailable');
        if (saved.some((item) => item?.sourceId === sourceId))
            localStorage.setItem(
                key,
                JSON.stringify(
                    saved.filter((item) => item?.sourceId !== sourceId)
                )
            );
    }
}

/** Retire the cache before a replacement source can accept local sidecar edits. */
export function retireFavoriteSourceContext(
    instanceId: string,
    sourceId: string
): void {
    removeCachedContext(instanceId, sourceId);
    const detail = { instanceId, sourceId, nonce: createRandomId() };
    localStorage.setItem(
        `${favoriteSourceContextsKey(instanceId)}:retired`,
        JSON.stringify(detail)
    );
    window.dispatchEvent(new CustomEvent(RETIRED, { detail }));
}

export function observeFavoriteSourceRetirement(
    current: () => FavoritesSyncClient | undefined
): () => void {
    const retire = (
        detail: { instanceId?: string; sourceId?: string } | null
    ) => {
        const client = current();
        if (
            client &&
            detail?.instanceId === client.options.instanceId &&
            typeof detail.sourceId === 'string'
        ) {
            client.forget(detail.sourceId, false);
            removeCachedContext(detail.instanceId, detail.sourceId);
        }
    };
    const event = (event: Event) => retire((event as CustomEvent).detail);
    const storage = (event: StorageEvent) => {
        const client = current();
        if (
            !client ||
            event.key !==
                `${favoriteSourceContextsKey(client.options.instanceId)}:retired`
        )
            return;
        try {
            retire(JSON.parse(event.newValue ?? 'null'));
        } catch {
            /* An invalid notification cannot establish source ownership. */
        }
    };
    window.addEventListener(RETIRED, event);
    window.addEventListener('storage', storage);
    return () => {
        window.removeEventListener(RETIRED, event);
        window.removeEventListener('storage', storage);
    };
}
