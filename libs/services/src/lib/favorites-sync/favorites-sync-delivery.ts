import {
    assertFavoriteState,
    type FavoriteResult,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesSyncClient } from './favorites-sync-client';
import { FavoriteSupersededError } from './favorites-sync-errors';
export async function deliverFavorites(
    this: FavoritesSyncClient
): Promise<void> {
    const generation = this.generation();
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
            if (result.status === 'conflict')
                return {
                    ...current,
                    base: result.state,
                    conflict: result.state,
                };
            const pending = current.pending.slice(1);
            const base =
                result.state.revision >= current.base.revision
                    ? result.state
                    : current.base;
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
}
