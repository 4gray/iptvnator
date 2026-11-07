import type { FavoritesSyncClient } from './favorites-sync-client';
import { createRandomId } from '@iptvnator/shared/interfaces';

const RETIRED = 'iptvnator-favorites-source-retired';
export const favoriteSourceContextsKey = (instanceId: string) =>
    `iptvnator-server:${instanceId}:favorites-contexts-v1`;
export const favoriteSourceRetirementKey = (instanceId: string) =>
    `${favoriteSourceContextsKey(instanceId)}:retired`;

function cachedContexts(
    instanceId: string
): { sourceId: string; sourceIncarnation: string }[] {
    const saved: unknown = JSON.parse(
        localStorage.getItem(favoriteSourceContextsKey(instanceId)) ?? '[]'
    );
    if (
        !Array.isArray(saved) ||
        saved.some(
            (item) =>
                !item ||
                typeof item.sourceId !== 'string' ||
                typeof item.sourceIncarnation !== 'string'
        )
    )
        throw new Error('Favorite context storage unavailable');
    return saved;
}

function removeCachedContext(
    instanceId: string,
    sourceId: string,
    incarnation: string | undefined
): void {
    const saved = cachedContexts(instanceId);
    const retained = saved.filter(
        (item) =>
            item.sourceId !== sourceId || item.sourceIncarnation !== incarnation
    );
    if (retained.length !== saved.length)
        localStorage.setItem(
            favoriteSourceContextsKey(instanceId),
            JSON.stringify(retained)
        );
}

/** Retire the cache before a replacement source can accept local sidecar edits. */
export function retireFavoriteSourceContext(
    instanceId: string,
    sourceId: string
): void {
    if (
        localStorage.getItem(
            `iptvnator-server:${instanceId}:history-consent-v1`
        )
    ) {
        localStorage.setItem(
            `iptvnator-server:${instanceId}:history-source-epoch:${sourceId}`,
            createRandomId()
        );
        const historyKey = `iptvnator-server:${instanceId}:history-contexts-v1`;
        const history = JSON.parse(
            localStorage.getItem(historyKey) ?? '[]'
        ) as { sourceId: string }[];
        localStorage.setItem(
            historyKey,
            JSON.stringify(
                history.filter((context) => context.sourceId !== sourceId)
            )
        );
    }
    const sourceIncarnation = cachedContexts(instanceId).find(
        (item) => item.sourceId === sourceId
    )?.sourceIncarnation;
    removeCachedContext(instanceId, sourceId, sourceIncarnation);
    const detail = {
        instanceId,
        sourceId,
        sourceIncarnation,
        nonce: createRandomId(),
    };
    localStorage.setItem(
        favoriteSourceRetirementKey(instanceId),
        JSON.stringify(detail)
    );
    window.dispatchEvent(new CustomEvent(RETIRED, { detail }));
}

export function observeFavoriteSourceRetirement(
    current: () => FavoritesSyncClient | undefined
): () => void {
    const retire = (
        detail: {
            instanceId?: string;
            sourceId?: string;
            sourceIncarnation?: string;
        } | null
    ) => {
        const client = current();
        if (
            client &&
            detail?.instanceId === client.options.instanceId &&
            typeof detail.sourceId === 'string' &&
            client.contexts.get(detail.sourceId)?.sourceIncarnation ===
                detail.sourceIncarnation &&
            !cachedContexts(detail.instanceId).some(
                (context) =>
                    context.sourceId === detail.sourceId &&
                    context.sourceIncarnation === detail.sourceIncarnation
            )
        )
            client.forget(detail.sourceId, false);
    };
    const event = (event: Event) => retire((event as CustomEvent).detail);
    const storage = (event: StorageEvent) => {
        const client = current();
        if (
            !client ||
            event.key !== favoriteSourceRetirementKey(client.options.instanceId)
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
