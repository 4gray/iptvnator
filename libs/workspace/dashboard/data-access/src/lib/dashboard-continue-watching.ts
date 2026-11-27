import {
    computed,
    effect,
    inject,
    linkedSignal,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { isPortalPlaybackWatched } from '@iptvnator/portal/shared/util';
import {
    resolvePortalActivityWatchKind,
    type PlaybackPositionData,
    type PlaylistMeta,
    type PortalActivityItem,
    type PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import {
    CONTINUE_WATCHING_SERIES_LOOKUP_WAIT_MS,
    dashboardRecentItemKey,
    planDashboardSeriesLookups,
    classifyDashboardSeries,
    selectSeriesContinuationCandidates,
    type DashboardSeriesContinuation,
} from './dashboard-series-continuation.util';
import {
    DashboardSeriesEpisodesService,
    createDashboardSeriesEpisodesRequest,
    sameDashboardSeriesEpisodesRequests,
    type DashboardSeriesEpisodesRequest,
} from './dashboard-series-episodes.service';
import { ambiguousDashboardStalkerSeriesParents } from './dashboard-series-episodes-request';
import { seriesPlaybackPositionMapKey } from './dashboard-playback-positions';

/** What the rail reads from the dashboard's history and playback positions. */
export interface DashboardContinueWatchingDeps {
    /** The history's movies and series, newest first. */
    readonly items: Signal<readonly PortalRecentItem[]>;
    /** The history has loaded once. */
    readonly historyLoaded: Signal<boolean>;
    readonly playlists: Signal<readonly PlaylistMeta[]>;
    /** A title's stored position (a series: its newest episode's). */
    readonly storedPosition: (
        item: PortalActivityItem
    ) => PlaybackPositionData | null;
    /** Every episode row of a series: what comes next depends on all of them. */
    readonly episodeRows: (
        playlistId: string,
        seriesXtreamId: number
    ) => readonly PlaybackPositionData[] | undefined;
    /** Playlists whose positions have loaded; null before any load. */
    readonly positionsLoadedFor: Signal<ReadonlySet<string> | null>;
    /**
     * Counts the position reloads that landed (dashboard entry, a changed
     * history, "Mark watched"): each is a lookup round, which retries failed
     * episode lookups and refreshes lists past their age.
     */
    readonly positionReloads: Signal<number>;
}

export interface DashboardContinueWatching {
    /**
     * Continue Watching tells unfinished titles from finished ones by their
     * playback positions, so it waits until the history and the positions of
     * every playlist in it have loaded once, and until the episode lists of
     * series whose newest episode is watched or an extra are in (for at most
     * CONTINUE_WATCHING_SERIES_LOOKUP_WAIT_MS): rendering every title first
     * and dropping the finished ones a moment later would shift the page.
     * Stays true afterwards; later reloads update the rail in place.
     */
    readonly settled: Signal<boolean>;
    /**
     * Recent movies and series the user has not finished, newest first. A
     * movie leaves once its position reaches the watched threshold, whether
     * playback got there or the user marked it. A series whose newest
     * episode is watched, or is an extra, stays with the episode it
     * continues with and leaves once none follows the one watched last
     * (extras aside); one that cannot be looked up keeps its place. The full
     * history stays on the global recent page.
     */
    readonly items: Signal<PortalRecentItem[]>;
    /** What a looked-up series continues with; none for other titles. */
    continuationFor(
        item: PortalActivityItem
    ): DashboardSeriesContinuation | undefined;
}

/**
 * The Continue Watching rail's list and its loading gate. A series whose
 * newest episode is watched, or is an extra, goes on with an episode only
 * the portal's episode list names, so the series to look past are fetched
 * through `DashboardSeriesEpisodesService` and resolved with
 * `classifyDashboardSeries`. Call from an injection context.
 */
export function createDashboardContinueWatching(
    deps: DashboardContinueWatchingDeps
): DashboardContinueWatching {
    const seriesEpisodes = inject(DashboardSeriesEpisodesService);
    const lookupWaitOver = signal(false);
    let lookupWaitStarted = false;

    /**
     * A title listed without an episode lookup: a movie not watched yet, or
     * a series, which keeps its place until a lookup says it is finished.
     */
    const listedWithoutLookup = (item: PortalRecentItem): boolean =>
        resolvePortalActivityWatchKind(item) === 'series' ||
        !isPortalPlaybackWatched(deps.storedPosition(item));

    const ambiguousParents = computed(() =>
        ambiguousDashboardStalkerSeriesParents(deps.items())
    );
    const allowUnmapped = (
        item: PortalActivityItem,
        newest: PlaybackPositionData
    ) =>
        item.source === 'stalker' &&
        !newest.activityIdentity &&
        newest.seriesXtreamId !== undefined &&
        ambiguousParents().has(
            seriesPlaybackPositionMapKey(
                item.playlist_id,
                newest.seriesXtreamId
            )
        );

    const candidates = computed(() =>
        selectSeriesContinuationCandidates(
            deps.items(),
            deps.storedPosition,
            (item, newest) =>
                allowUnmapped(item, newest) &&
                newest.seriesXtreamId !== undefined &&
                !!deps
                    .episodeRows(item.playlist_id, newest.seriesXtreamId)
                    ?.some(isPortalPlaybackWatched)
        )
    );

    /**
     * Which candidates to look up, and what each continues with
     * (`planDashboardSeriesLookups`): newest first until the rail's titles
     * are known, so a finished series frees its slot for an older one.
     */
    const lookupPlan = computed(() => {
        const playlists = new Map(
            deps.playlists().map((playlist) => [playlist._id, playlist])
        );
        const requests: DashboardSeriesEpisodesRequest[] = [];
        const plan = planDashboardSeriesLookups({
            items: deps.items(),
            candidates: candidates(),
            listedWithoutLookup,
            resolve: (candidate) => {
                const { item, newest, seriesXtreamId } = candidate;
                const request = createDashboardSeriesEpisodesRequest(
                    item,
                    playlists.get(item.playlist_id),
                    seriesXtreamId
                );
                if (!request) {
                    return { kind: 'unknown' };
                }
                const { continuation } = classifyDashboardSeries({
                    request,
                    newest,
                    positions: deps.episodeRows(
                        item.playlist_id,
                        seriesXtreamId
                    ) ?? [newest],
                    episodes: seriesEpisodes.get(request),
                    allowUnmappedLatest: allowUnmapped(item, newest),
                });
                requests.push(
                    continuation.kind === 'unknown' && continuation.stale
                        ? { ...request, refresh: true }
                        : request
                );
                return continuation;
            },
        });
        return { ...plan, requests };
    });

    // Equal requests keep the previous value so unrelated playlist changes
    // do not trigger another round of episode lookups.
    const requests = computed(() => lookupPlan().requests, {
        equal: sameDashboardSeriesEpisodesRequests,
    });

    const lookupsSettled = computed(() =>
        requests().every((request) => {
            const status = seriesEpisodes.get(request)?.status;
            return status === 'loaded' || status === 'failed';
        })
    );

    /** What each looked-up series continues with, by recent item key. */
    const continuations = computed(() => lookupPlan().continuations);

    const settled = linkedSignal<boolean, boolean>({
        source: () => {
            const loaded = deps.positionsLoadedFor();
            return (
                deps.historyLoaded() &&
                deps
                    .items()
                    .every((item) => loaded?.has(item.playlist_id) ?? false) &&
                (lookupsSettled() || lookupWaitOver())
            );
        },
        computation: (ready, previous) => previous?.value === true || ready,
    }).asReadonly();

    const items = computed<PortalRecentItem[]>(() => {
        if (!settled()) {
            return [];
        }
        const known = continuations();
        return deps.items().filter((item) => {
            const continuation = known.get(dashboardRecentItemKey(item));
            return continuation
                ? continuation.kind !== 'finished'
                : listedWithoutLookup(item);
        });
    });

    // Runs when the list of series to look up changes, and on each positions
    // reload: the deliberate moments a failed lookup is tried again.
    effect(() => {
        const pending = requests();
        const round = deps.positionReloads();
        if (pending.length === 0) {
            return;
        }
        untracked(() => {
            seriesEpisodes.request(pending, round);
            if (!lookupWaitStarted) {
                lookupWaitStarted = true;
                setTimeout(
                    () => lookupWaitOver.set(true),
                    CONTINUE_WATCHING_SERIES_LOOKUP_WAIT_MS
                );
            }
        });
    });

    return {
        settled,
        items,
        continuationFor: (item) =>
            continuations().get(dashboardRecentItemKey(item)),
    };
}
