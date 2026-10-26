import {
    applySourceDefinition,
    sourceFromPlaylist,
    sameSource,
    PlaylistUpdateState,
    type Playlist,
    type SourceDefinition,
} from '@iptvnator/shared/interfaces';
import { createPlaylistObject } from '@iptvnator/shared/m3u-utils';
import type { DataService } from '../data.service';

export async function materializeSource(
    source: SourceDefinition,
    current: Playlist | undefined,
    data: DataService
): Promise<Playlist> {
    let next = applySourceDefinition(source, current);
    const previous = current ? sourceFromPlaylist(current) : undefined;
    const connectionChanged =
        previous && !sameSource({ ...previous, title: source.title }, source);
    if (connectionChanged) {
        delete next.stalkerToken;
        delete next.stalkerSessionIdentity;
        delete next.stalkerAccountInfo;
        delete next.stalkerWatchdogTimeout;
        delete next.stalkerTimeslot;
        delete next.serverTimezone;
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
            _id: source.id,
            favorites: next.favorites,
            recentlyViewed: next.recentlyViewed,
            sourceRawM3u: source.rawM3u,
        };
    } else if (
        source.kind === 'm3u-url' &&
        (!current?.playlist || connectionChanged)
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
            };
        } catch {
            next.updateState = PlaylistUpdateState.NOT_UPDATED;
        }
    }
    return next;
}
