import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import type { FavoriteEntry } from '@iptvnator/shared/interfaces/favorites-sync';
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
