import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { StalkerItvChannel } from './models';
import { StalkerPagedCatalog } from './stalker-paged-client';
import {
    executeStalkerRequest,
    StalkerRequestDeps,
    toStalkerContentItem,
    toStalkerItvChannel,
} from './stores/utils';

/** Some portals omit whole genres from get_all_channels; browse them explicitly. */
export async function loadStalkerItvGenre(
    deps: StalkerRequestDeps,
    playlist: PlaylistMeta,
    genre: string,
    signal: AbortSignal
): Promise<StalkerItvChannel[]> {
    const catalog = new StalkerPagedCatalog((params) =>
        executeStalkerRequest(deps, playlist, params, { silent: true })
    );
    const rows: StalkerItvChannel[] = [];
    const seen = new Set<string>();
    let page = 0;
    let received = 0;
    while (rows.length < 30000) {
        signal.throwIfAborted();
        const result = await catalog.load(
            { type: 'itv', category: genre, genre, sortby: 'number' },
            page++,
            signal
        );
        signal.throwIfAborted();
        const before = rows.length;
        received += result.data.length;
        for (const row of result.data) {
            const channel = toStalkerItvChannel(
                toStalkerContentItem(row, playlist.portalUrl ?? '')
            );
            const id = String(channel.id).trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            rows.push({
                ...channel,
                tv_genre_id:
                    typeof row['tv_genre_id'] === 'string' ||
                    typeof row['tv_genre_id'] === 'number'
                        ? row['tv_genre_id']
                        : genre,
            });
        }
        if (received >= result.total || rows.length === before) return rows;
    }
    throw new Error('Stalker genre exceeds the channel limit');
}
