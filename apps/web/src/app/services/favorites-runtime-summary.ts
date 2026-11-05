import {
    FavoriteRequestError,
    type FavoritesSyncClient,
} from '@iptvnator/services/favorites-sync';
import type { FavoriteEntry } from '@iptvnator/shared/interfaces/favorites-sync';
export function favoriteFailureState(error: unknown, locked: boolean): string {
    const storage =
        /storage|quota|indexeddb|database/i.test(
            error instanceof Error ? error.message : ''
        ) ||
        ['QuotaExceededError', 'SecurityError'].includes(
            error instanceof Error ? error.name : ''
        );
    return locked ||
        (error instanceof FavoriteRequestError && error.status === 401)
        ? 'locked'
        : error instanceof FavoriteRequestError && error.status === 404
          ? 'incompatible'
          : storage
            ? 'storage-error'
            : 'offline';
}
export async function readFavoriteSummary(
    client: FavoritesSyncClient,
    generation?: string
) {
    const entries = (
        await Promise.all(
            [...client.contexts.keys()].map((id) => client.entries(id))
        )
    ).reduce<FavoriteEntry[]>((all, rows) => all.concat(rows), []);
    const pending = entries.reduce(
        (n, entry) => n + entry.record.pending.length,
        0
    );
    const parked = entries.reduce(
        (n, entry) =>
            n +
            entry.record.pending.filter(
                (intent) => intent.consentGeneration !== generation
            ).length,
        0
    );
    const conflicts = entries.filter((entry) => !!entry.record.conflict);
    return {
        pending,
        parked,
        conflicts,
        state: conflicts.length
            ? 'conflict'
            : parked
              ? 'choice'
              : pending
                ? 'pending'
                : 'ready',
    };
}
