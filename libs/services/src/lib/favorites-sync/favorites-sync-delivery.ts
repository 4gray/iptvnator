import { latestFavoriteBase } from './favorites-client-state';
import {
    assertFavoriteState,
    type FavoriteResult,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesSyncClient } from './favorites-sync-client';
import {
    FavoriteRequestError,
    FavoriteSupersededError,
} from './favorites-sync-errors';
import type { ScopeRefusal } from '../profiles/scope-refusal';
import type { FavoritePending } from '@iptvnator/shared/interfaces/favorites-sync';

/** A deleted profile's queue is dropped with it; a switched-off scope keeps its queue for later. */
async function parkRefusedFavorite(
    client: FavoritesSyncClient,
    intent: FavoritePending,
    refusal: ScopeRefusal
): Promise<void> {
    if (refusal !== 'profile_missing') return;
    await client.store.mutate(intent.address, (current) => {
        if (!current) throw new FavoriteSupersededError();
        return { ...current, pending: [], state: current.base };
    });
}
export async function refreshFavoriteSources(
    client: FavoritesSyncClient,
    sourceIds: string[]
): Promise<void> {
    const ids = new Set(sourceIds);
    for (const id of client.contexts.keys())
        if (!ids.has(id)) client.forget(id);
    for (const id of ids) await client.refresh(id, false);
    await client.flush();
}

export async function deliverFavorites(
    this: FavoritesSyncClient
): Promise<void> {
    const generation = this.generation();
    let failure: { error: unknown } | undefined;
    for (const intent of await this.store.pending()) {
        this.current(generation);
        if (
            intent.consentGeneration !== generation ||
            this.contexts.get(intent.address.sourceId)?.sourceIncarnation !==
                intent.address.sourceIncarnation
        )
            continue;
        const before = await this.store.read(intent.address);
        if (
            before?.conflict ||
            before?.pending[0]?.operation.operationId !==
                intent.operation.operationId
        )
            continue;
        let result: FavoriteResult;
        try {
            result = (await this.request(
                {
                    operation: 'favorites-apply',
                    favorite: {
                        address: intent.address,
                        operation: intent.operation,
                    },
                },
                generation
            )) as FavoriteResult;
            assertFavoriteState(result.state);
            if (!['applied', 'conflict'].includes(result.status))
                throw new Error('Invalid favorite receipt');
        } catch (error) {
            if (error instanceof FavoriteSupersededError) throw error;
            if (error instanceof FavoriteRequestError && error.refusal) {
                // One scope's refusal never blocks the others.
                await parkRefusedFavorite(this, intent, error.refusal);
                continue;
            }
            failure ??= { error };
            continue; // Durable intent stays queued for reconnect/restart.
        }
        await this.store.mutate(intent.address, (current) => {
            this.current(generation);
            if (
                !current ||
                this.contexts.get(intent.address.sourceId)
                    ?.sourceIncarnation !== intent.address.sourceIncarnation
            )
                throw new FavoriteSupersededError();
            const head = current.pending[0];
            if (
                head?.operation.operationId !== intent.operation.operationId ||
                head.consentGeneration !== generation
            )
                return current;
            const known = latestFavoriteBase(current);
            const base =
                result.state.revision >= known.revision ? result.state : known;
            if (result.status === 'conflict')
                return { ...current, base, conflict: base };
            const pending = current.pending.slice(1);
            return {
                ...current,
                base,
                pending,
                state: pending.length ? current.state : base,
                conflict: undefined,
            };
        });
    }
    this.options.changed();
    if (failure) throw failure.error;
}
