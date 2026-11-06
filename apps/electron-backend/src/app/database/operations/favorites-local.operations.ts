import { assertActivityToken } from '@iptvnator/shared/interfaces/activity-sync';
import type Database from 'better-sqlite3';
import { SqliteFavoriteLocalStore } from '@iptvnator/shared/database/favorites-sync';
import {
    parseFavoriteAddress,
    type FavoriteLocalRequest,
} from '@iptvnator/shared/interfaces/favorites-sync';

export async function favoriteLocalOperation(
    database: Database.Database,
    request: FavoriteLocalRequest
): Promise<unknown> {
    assertActivityToken(request.instanceId);
    const store = new SqliteFavoriteLocalStore(database, request.instanceId);
    if (request.operation === 'pending') return store.pending();
    if (request.operation === 'list') return store.entries(request.sourceId);
    const address = parseFavoriteAddress(request.address);
    if (request.operation === 'read') return store.read(address);
    if (request.operation !== 'commit')
        throw new Error('Invalid favorite storage operation');
    try {
        const value = await store.mutate(address, (current) => {
            if (
                (current === null ? null : JSON.stringify(current)) !==
                request.expected
            ) {
                throw new Error('favorite_local_conflict');
            }
            return request.value;
        });
        return { value };
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'favorite_local_conflict'
        )
            return { conflict: true };
        throw new Error('Favorite storage failed');
    }
}
