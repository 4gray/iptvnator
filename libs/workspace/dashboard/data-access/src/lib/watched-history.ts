import {
    computed,
    DestroyRef,
    effect,
    inject,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    buildXtreamCollectionUid,
    isPortalPlaybackWatched,
    PORTAL_PLAYBACK_POSITIONS,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { normalizeStalkerEntityIdAsNumber } from '@iptvnator/portal/stalker/data-access';
import { observeActivityChanges } from '@iptvnator/services/activity-changes';
import {
    isCatalogUnavailable,
    isStalkerSeriesItem,
    type PlaybackPositionData,
    type PlaylistMeta,
    type StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import {
    loadDashboardPlaybackPositions,
    newestDashboardStalkerSeriesPosition,
    playbackPositionMapKey,
    seriesPlaybackPositionMapKey,
    type DashboardPlaybackPositionMaps,
} from './dashboard-playback-positions';
import { classifyDashboardSeries } from './dashboard-series-continuation.util';
import {
    ambiguousDashboardStalkerSeriesParents,
    createDashboardSeriesEpisodesRequest,
    dashboardSeriesEpisodesRequestKey,
    type DashboardSeriesEpisodesRequest,
} from './dashboard-series-episodes-request';
import { DashboardSeriesEpisodesService } from './dashboard-series-episodes.service';

const PREVIEW_LENGTH = 8;
const PREVIEW_LOOKUPS = 12;
const PAGE_LOOKUPS = 20;

interface WatchedHistoryOptions {
    readonly items: Signal<readonly UnifiedCollectionItem[]>;
    readonly active: Signal<boolean>;
    readonly expanded: Signal<boolean>;
    readonly page: Signal<number>;
}

interface HistorySeries {
    readonly request: DashboardSeriesEpisodesRequest;
    readonly newest: PlaybackPositionData;
    readonly positions: readonly PlaybackPositionData[];
    readonly allowUnmappedLatest: boolean;
}

interface HistoryCandidate {
    readonly item: UnifiedCollectionItem;
    /** An absent series is a movie whose position already says it is watched. */
    readonly series?: HistorySeries;
}

function watchedCandidates(
    items: readonly UnifiedCollectionItem[],
    playback: DashboardPlaybackPositionMaps,
    playlists: ReadonlyMap<string, PlaylistMeta>
): HistoryCandidate[] {
    const candidates: HistoryCandidate[] = [];
    const seen = new Set<string>();
    const ambiguousParents = ambiguousDashboardStalkerSeriesParents(items);
    for (const item of items) {
        const id =
            item.sourceType === 'stalker'
                ? normalizeStalkerEntityIdAsNumber(item.stalkerId)
                : item.xtreamId;
        if (id == null) continue;

        const series =
            item.contentType === 'series' ||
            (item.sourceType === 'stalker' &&
                isStalkerSeriesItem(item.stalkerItem as StalkerPortalItem));
        if (!series) {
            if (
                isPortalPlaybackWatched(
                    playback.byContent.get(
                        playbackPositionMapKey(item.playlistId, id, 'vod')
                    )
                )
            ) {
                candidates.push({ item });
            }
            continue;
        }

        // Some old history rows name an episode rather than its series.
        // A matching parent still wins when the two ID spaces overlap.
        const parentKey = seriesPlaybackPositionMapKey(item.playlistId, id);
        const indexedNewest =
            playback.newestBySeries.get(parentKey) ??
            playback.byContent.get(
                playbackPositionMapKey(item.playlistId, id, 'episode')
            );
        const parentId = indexedNewest?.seriesXtreamId;
        if (!indexedNewest || parentId == null) continue;
        const request = createDashboardSeriesEpisodesRequest(
            item,
            playlists.get(item.playlistId),
            parentId
        );
        if (!request) continue;
        const key = dashboardSeriesEpisodesRequestKey(request);
        if (seen.has(key)) continue;
        const resolvedKey = seriesPlaybackPositionMapKey(
            item.playlistId,
            parentId
        );
        const latest =
            playback.newestBySeries.get(resolvedKey) ?? indexedNewest;
        const positions = playback.episodesBySeries.get(resolvedKey) ?? [
            latest,
        ];
        const newest =
            request.provider === 'stalker'
                ? newestDashboardStalkerSeriesPosition(
                      playback,
                      item.playlistId,
                      parentId,
                      request.item.stalkerId,
                      request.item.stalkerItem as StalkerPortalItem | undefined
                  )
                : latest;
        if (!newest) continue;
        const allowUnmappedLatest =
            request.provider === 'stalker' &&
            !newest.activityIdentity &&
            ambiguousParents.has(resolvedKey);
        if (
            !isPortalPlaybackWatched(newest) &&
            newest.seasonNumber !== 0 &&
            !(allowUnmappedLatest && positions.some(isPortalPlaybackWatched))
        ) {
            continue;
        }
        seen.add(key);
        const detailItem =
            item.sourceType === 'xtream' && item.xtreamId !== parentId
                ? {
                      ...item,
                      uid: buildXtreamCollectionUid(
                          item.playlistId,
                          'series',
                          parentId
                      ),
                      xtreamId: parentId,
                  }
                : item;
        candidates.push({
            item: detailItem,
            series: { request, newest, positions, allowUnmappedLatest },
        });
    }
    return candidates;
}

/** The history owns its projection and lookup budget; the dashboard shares only the catalog cache. */
export function createWatchedHistory(options: WatchedHistoryOptions) {
    const destroyRef = inject(DestroyRef);
    const positions = inject(PORTAL_PLAYBACK_POSITIONS);
    const catalogs = inject(DashboardSeriesEpisodesService);
    const playlists = inject(Store).selectSignal(selectAllPlaylistsMeta);
    const consumer = {};
    const history = computed(() =>
        options.active()
            ? options
                  .items()
                  .filter(
                      (item) =>
                          item.sourceType !== 'm3u' &&
                          item.contentType !== 'live' &&
                          !isCatalogUnavailable(item)
                  )
            : []
    );
    const playlistIds = computed(
        () => [...new Set(history().map((item) => item.playlistId))].sort(),
        {
            equal: (a, b) =>
                a.length === b.length &&
                a.every((id, index) => id === b[index]),
        }
    );
    const invalidation = signal(0);
    const refresh = () => invalidation.update((revision) => revision + 1);
    const batch = signal<{
        ids: readonly string[];
        playback: DashboardPlaybackPositionMaps;
        round: number;
    } | null>(null);
    let round = 0;

    effect((onCleanup) => {
        const ids = playlistIds();
        const revision = invalidation();
        if (!ids.length) {
            batch.set(null);
            return;
        }
        let current = true;
        onCleanup(() => {
            current = false;
        });
        void loadDashboardPlaybackPositions(positions, ids).then((playback) => {
            if (
                current &&
                playlistIds() === ids &&
                invalidation() === revision
            ) {
                batch.set({ ids, playback, round: ++round });
            }
        });
    });

    destroyRef.onDestroy(observeActivityChanges(refresh));
    window.addEventListener('iptvnator-history-changed', refresh);
    destroyRef.onDestroy(() =>
        window.removeEventListener('iptvnator-history-changed', refresh)
    );

    const loaded = computed(() => {
        const value = batch();
        return value?.ids === playlistIds() ? value : null;
    });
    const candidates = computed(() => {
        const value = loaded();
        return value
            ? watchedCandidates(
                  history(),
                  value.playback,
                  new Map(
                      playlists().map((playlist) => [playlist._id, playlist])
                  )
              )
            : [];
    });
    const state = computed(() => {
        const confirmed: UnifiedCollectionItem[] = [];
        const requests: DashboardSeriesEpisodesRequest[] = [];
        const full = options.expanded();
        const limit = full ? options.page() * PAGE_LOOKUPS : PREVIEW_LOOKUPS;
        let pending = false;
        let hasMore = false;
        for (const candidate of candidates()) {
            if (candidate.series) {
                if (requests.length >= limit) {
                    hasMore = true;
                    continue;
                }
                const { request } = candidate.series;
                const episodes = catalogs.get(request);
                const result = classifyDashboardSeries({
                    ...candidate.series,
                    episodes,
                });
                const stale =
                    result.continuation.kind === 'unknown' &&
                    result.continuation.stale;
                requests.push(stale ? { ...request, refresh: true } : request);
                pending ||= !episodes || episodes.status === 'loading';
                if (!result.fullyWatched) continue;
            }
            confirmed.push(candidate.item);
        }
        return {
            items: full ? confirmed : confirmed.slice(0, PREVIEW_LENGTH),
            pending,
            hasMore,
            requests,
        };
    });

    effect(() => {
        const value = loaded();
        const requests = state().requests;
        if (value && requests.length) {
            untracked(() => catalogs.request(requests, value.round, consumer));
        }
    });

    return {
        items: computed(() => state().items),
        loading: computed(
            () => (playlistIds().length > 0 && !loaded()) || state().pending
        ),
        hasMore: computed(() => state().hasMore),
        refresh,
    };
}
