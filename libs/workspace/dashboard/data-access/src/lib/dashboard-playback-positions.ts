import { createLogger } from '@iptvnator/portal/shared/util/logger';
import {
    resolvePortalActivityWatchKind,
    type PlaybackPositionData,
    type PortalActivityItem,
    type StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    dashboardStalkerSeriesMode,
    type DashboardStalkerSeriesMode,
} from './dashboard-series-episodes-request';

const logger = createLogger('DashboardData');

/** What the loader reads positions through (PORTAL_PLAYBACK_POSITIONS). */
export interface DashboardPlaybackPositionSource {
    getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]>;
}

/** The dashboard's playback positions, indexed the ways its cards read them. */
export interface DashboardPlaybackPositionMaps {
    /** By `${playlistId}::${contentXtreamId}::${contentType}`. */
    readonly byContent: Map<string, PlaybackPositionData>;
    /** A series' newest episode row, by `${playlistId}::${seriesXtreamId}`. */
    readonly newestBySeries: Map<string, PlaybackPositionData>;
    /** Every episode row of a series: what comes next depends on all of them. */
    readonly episodesBySeries: Map<string, PlaybackPositionData[]>;
}

// Compound key for looking up a playback position by recent item — a single
// playlist can contain the same xtream-id for a VOD and an episode (rare,
// but the schema allows it), so contentType is part of the key.
export function playbackPositionMapKey(
    playlistId: string,
    contentXtreamId: number,
    contentType: 'vod' | 'episode'
): string {
    return `${playlistId}::${contentXtreamId}::${contentType}`;
}

export function seriesPlaybackPositionMapKey(
    playlistId: string,
    seriesXtreamId: number
): string {
    return `${playlistId}::${seriesXtreamId}`;
}

export function storedDashboardPlaybackPositionForItem(
    maps: DashboardPlaybackPositionMaps,
    item: PortalActivityItem
): PlaybackPositionData | null {
    const watchKind = resolvePortalActivityWatchKind(item);
    const id = Number(item.xtream_id);
    if (!watchKind || !Number.isFinite(id)) return null;
    if (watchKind === 'movie') {
        return (
            maps.byContent.get(
                playbackPositionMapKey(item.playlist_id, id, 'vod')
            ) ?? null
        );
    }
    if (item.source === 'stalker') {
        return newestDashboardStalkerSeriesPosition(
            maps,
            item.playlist_id,
            id,
            item.xtream_id,
            item.stalker_item
        );
    }
    // Older Xtream recent rows can name an episode. A matching parent wins
    // when it shares its id with an episode from another series.
    return (
        maps.newestBySeries.get(
            seriesPlaybackPositionMapKey(item.playlist_id, id)
        ) ??
        maps.byContent.get(
            playbackPositionMapKey(item.playlist_id, id, 'episode')
        ) ??
        null
    );
}

export function newestDashboardStalkerSeriesPosition(
    maps: DashboardPlaybackPositionMaps,
    playlistId: string,
    parentId: number,
    rawId: string | number | undefined,
    rawItem: StalkerPortalItem | undefined
): PlaybackPositionData | null {
    const key = seriesPlaybackPositionMapKey(playlistId, parentId);
    const newest = maps.newestBySeries.get(key);
    if (!newest?.activityIdentity) return newest ?? null;
    const mode = dashboardStalkerSeriesMode(rawItem);
    if (matchesStalkerSeriesPosition(newest, mode, rawId)) return newest;

    // Stalker can reuse a parent id across its regular and VOD catalogs.
    let selected: PlaybackPositionData | null = null;
    for (const row of maps.episodesBySeries.get(key) ?? []) {
        if (matchesStalkerSeriesPosition(row, mode, rawId)) {
            selected = newestPlaybackPosition(selected, row);
        }
    }
    return selected;
}

export function matchesStalkerSeriesPosition(
    position: PlaybackPositionData,
    mode: DashboardStalkerSeriesMode,
    parentId: string | number | undefined
): boolean {
    const identity = position.activityIdentity;
    return (
        !identity ||
        (identity.provider === 'stalker' &&
            identity.kind === 'episode' &&
            identity.mode === mode &&
            identity.seriesId === String(parentId))
    );
}

export function newestPlaybackPosition(
    current: PlaybackPositionData | null | undefined,
    candidate: PlaybackPositionData | null | undefined
): PlaybackPositionData | null {
    if (!current) {
        return candidate ?? null;
    }
    if (!candidate) {
        return current;
    }
    const candidateAt = candidate.updatedAt ?? '';
    const currentAt = current.updatedAt ?? '';
    if (candidateAt !== currentAt) {
        return candidateAt > currentAt ? candidate : current;
    }
    // Saved in the same second (a season marked watched, a quick skip):
    // the later episode, as `getSeriesNextUp` breaks the tie.
    return episodeOrder(candidate) > episodeOrder(current)
        ? candidate
        : current;
}

function episodeOrder(position: PlaybackPositionData): number {
    return (
        (position.seasonNumber ?? 0) * 100_000 + (position.episodeNumber ?? 0)
    );
}

export function emptyDashboardPlaybackPositionMaps(): DashboardPlaybackPositionMaps {
    return {
        byContent: new Map(),
        newestBySeries: new Map(),
        episodesBySeries: new Map(),
    };
}

/**
 * Loads the playback positions of every given playlist, all at once: one
 * bulk IPC per playlist, all dispatched together, so the single-threaded DB
 * worker answers the set in one pass and a long request it is busy with (a
 * catalog import, a TMDB title match) delays the set once rather than once
 * per playlist. A playlist whose load fails contributes no rows: its titles
 * show without progress rather than holding the rail back.
 */
export async function loadDashboardPlaybackPositions(
    source: DashboardPlaybackPositionSource,
    playlistIds: Iterable<string>
): Promise<DashboardPlaybackPositionMaps> {
    const loaded = await Promise.all(
        [...playlistIds].map(async (playlistId) => {
            try {
                return {
                    playlistId,
                    positions: await source.getAllPlaybackPositions(playlistId),
                };
            } catch (error) {
                logger.warn(
                    'Failed to load playback positions for a playlist',
                    error
                );
                return { playlistId, positions: [] };
            }
        })
    );

    const maps = emptyDashboardPlaybackPositionMaps();
    for (const { playlistId, positions } of loaded) {
        for (const position of positions) {
            maps.byContent.set(
                playbackPositionMapKey(
                    playlistId,
                    position.contentXtreamId,
                    position.contentType
                ),
                position
            );
            if (
                position.contentType !== 'episode' ||
                !Number.isFinite(position.seriesXtreamId)
            ) {
                continue;
            }
            const seriesKey = seriesPlaybackPositionMapKey(
                playlistId,
                position.seriesXtreamId as number
            );
            maps.newestBySeries.set(
                seriesKey,
                newestPlaybackPosition(
                    maps.newestBySeries.get(seriesKey),
                    position
                ) as PlaybackPositionData
            );
            const seriesRows = maps.episodesBySeries.get(seriesKey);
            if (seriesRows) {
                seriesRows.push(position);
            } else {
                maps.episodesBySeries.set(seriesKey, [position]);
            }
        }
    }
    return maps;
}
