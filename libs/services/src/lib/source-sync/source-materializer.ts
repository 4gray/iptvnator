import {
    PlaylistUpdateState,
    type Playlist,
    type SourceDefinition,
} from '@iptvnator/shared/interfaces';
import {
    applySourceDefinition,
    sourceFromPlaylist,
    sameSource,
} from '@iptvnator/shared/interfaces/source-definition';
import {
    createPlaylistObject,
    resolvePlaylistEpgSourceState,
} from '@iptvnator/shared/m3u-utils';
import type { DataService } from '../data.service';

export async function materializeSource(
    source: SourceDefinition,
    current: Playlist | undefined,
    data: DataService
): Promise<Playlist> {
    let next = applySourceDefinition(source, current);
    if (source.kind !== 'm3u-url') delete next.sourceSyncPending;
    const previous = current ? sourceFromPlaylist(current) : undefined;
    const connectionChanged =
        previous && !sameSource({ ...previous, title: source.title }, source);
    if (connectionChanged) {
        const { invalidateObsoleteSourceSession } =
            await import('./source-stalker-session');
        next = invalidateObsoleteSourceSession(next);
    }
    if (
        source.kind === 'm3u-text' &&
        (!current?.playlist || previous?.rawM3u !== source.rawM3u)
    ) {
        const module = await import('iptv-playlist-parser');
        const parser = module.parse ?? module.default?.parse;
        const parsed = createPlaylistObject(
            source.title,
            parser(source.rawM3u!)
        );
        next = {
            ...parsed,
            ...next,
            playlist: parsed.playlist,
            count: parsed.count,
            ...projectEpgSources(parsed, next),
            _id: source.id,
            favorites: next.favorites,
            recentlyViewed: next.recentlyViewed,
            sourceRawM3u: source.rawM3u,
        };
    } else if (
        source.kind === 'm3u-url' &&
        (!current?.playlist || current.sourceSyncPending || connectionChanged)
    ) {
        if (current?.url !== source.url) {
            next.playlist = { header: { raw: '#EXTM3U' }, items: [] };
            next.count = 0;
        }
        try {
            const parsed = await data.fetchPlaylistDefinition(
                source.url!,
                source.userAgent
            );
            const materialized = parsed.playlist
                ? parsed
                : createPlaylistObject(source.title, parsed as never);
            next = {
                ...next,
                playlist: materialized.playlist,
                count: materialized.count,
                ...projectEpgSources(materialized, next),
                updateState: PlaylistUpdateState.UPDATED,
            };
            delete next.sourceSyncPending;
        } catch {
            next.updateState = PlaylistUpdateState.NOT_UPDATED;
            next.sourceSyncPending = true;
        }
    }
    return next;
}

function projectEpgSources(parsed: Partial<Playlist>, current: Playlist) {
    return resolvePlaylistEpgSourceState({
        detectedEpgUrls: parsed.detectedEpgUrls,
        enabledEpgUrls: parsed.epgUrls,
        manualEpgUrls: current.manualEpgUrls,
        disabledEpgUrls: current.disabledEpgUrls,
    });
}
