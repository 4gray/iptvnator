import {
    assertFavoriteState,
    parseFavoriteAddress,
    type FavoriteList,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    DEFAULT_PERSONAL_SCOPE,
    type PersonalScope,
} from '@iptvnator/shared/interfaces/profiles';
import type { FavoritesSyncClient } from './favorites-sync-client';
import { FavoriteSupersededError } from './favorites-sync-errors';

/** Only a non-Default scope travels on the wire; the Default's requests stay byte-identical. */
const scopeRequest = (scope: PersonalScope): { scope?: PersonalScope } =>
    scope === DEFAULT_PERSONAL_SCOPE ? {} : { scope };

/** Pull one source's entries for this client's scope into the local store. */
export async function refreshFavorites(
    client: FavoritesSyncClient,
    sourceId: string,
    deliver: boolean
): Promise<void> {
    const generation = client.generation();
    const source = await client.context(sourceId, generation);
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
        const page = (await client.request(
            {
                operation: 'favorites-list',
                id: sourceId,
                cursor,
                ...scopeRequest(client.scope),
            },
            generation
        )) as FavoriteList;
        if (!Array.isArray(page.entries))
            throw new Error('Invalid favorite list');
        for (const entry of page.entries) {
            const address = parseFavoriteAddress(entry.address);
            assertFavoriteState(entry.state);
            if (
                address.instanceId !== client.options.instanceId ||
                address.scope !== client.scope ||
                address.sourceId !== sourceId ||
                address.sourceIncarnation !== source.sourceIncarnation ||
                address.content.provider !== source.provider
            )
                throw new Error('Favorite scope mismatch');
            await client.store.mutate(address, (current) => {
                client.current(generation);
                if (
                    client.contexts.get(sourceId)?.sourceIncarnation !==
                    source.sourceIncarnation
                )
                    throw new FavoriteSupersededError();
                if (current && current.base.revision > entry.state.revision)
                    return current;
                if (current?.pending.length)
                    return {
                        ...current,
                        base: entry.state,
                        ...(current.conflict ? { conflict: entry.state } : {}),
                    };
                return {
                    ...current,
                    state: entry.state,
                    base: entry.state,
                    pending: [],
                };
            });
        }
        cursor = page.cursor;
        if (cursor && (typeof cursor !== 'string' || seen.has(cursor)))
            throw new Error('Invalid favorite cursor');
        if (cursor) seen.add(cursor);
    } while (cursor);
    if (deliver) await client.flush();
    client.options.changed();
}
