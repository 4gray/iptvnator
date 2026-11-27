import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import {
    firstNonBlankStalkerIdText,
    stalkerSecondStreamType,
} from '@iptvnator/portal/stalker/data-access';
import type { XtreamCredentials } from '@iptvnator/portal/xtream/data-access';
import {
    isCatalogUnavailable,
    isStalkerSeriesFlag,
    isStalkerSeriesItem,
    resolvePortalActivityWatchKind,
    type PlaylistMeta,
    type PortalActivityItem,
    type StalkerPortalItem,
} from '@iptvnator/shared/interfaces';
import { stalkerIdentityFingerprint } from '@iptvnator/shared/interfaces/stalker-session';

interface SeriesRequestIdentity {
    readonly playlistId: string;
    readonly seriesId: number;
    /** The cached list predates the episode played last. */
    readonly refresh?: boolean;
}

export type DashboardStalkerSeriesMode = 'regular' | 'embedded' | 'lazy';

export type DashboardSeriesEpisodesRequest = SeriesRequestIdentity &
    (
        | {
              readonly provider?: 'xtream';
              readonly credentials: XtreamCredentials;
          }
        | {
              readonly provider: 'stalker';
              readonly mode: DashboardStalkerSeriesMode;
              readonly item: UnifiedCollectionItem;
              readonly playlist: PlaylistMeta;
          }
    );

export function createDashboardSeriesEpisodesRequest(
    item: PortalActivityItem | UnifiedCollectionItem,
    playlist: PlaylistMeta | undefined,
    seriesId: number
): DashboardSeriesEpisodesRequest | null {
    const unified = 'sourceType' in item;
    const source = unified ? item.sourceType : item.source;
    const playlistId = unified ? item.playlistId : item.playlist_id;
    const watchKind = unified
        ? item.contentType
        : resolvePortalActivityWatchKind(item);
    if (
        !playlist ||
        playlist._id !== playlistId ||
        !Number.isSafeInteger(seriesId) ||
        seriesId <= 0 ||
        isCatalogUnavailable(item) ||
        (unified && item.catalogDisabled)
    ) {
        return null;
    }
    if (source === 'xtream') {
        if (
            watchKind !== 'series' ||
            !playlist.serverUrl ||
            !playlist.username ||
            !playlist.password
        ) {
            return null;
        }
        return {
            playlistId,
            seriesId,
            credentials: {
                serverUrl: playlist.serverUrl,
                username: playlist.username,
                password: playlist.password,
                userAgent: playlist.userAgent?.trim() || undefined,
            },
        };
    }
    const portalUrl = playlist.portalUrl ?? playlist.url;
    if (
        source !== 'stalker' ||
        !watchKind ||
        watchKind === 'live' ||
        !portalUrl ||
        !playlist.macAddress
    ) {
        return null;
    }
    const raw = (unified ? item.stalkerItem : item.stalker_item) as
        StalkerPortalItem | undefined;
    if (watchKind !== 'series' && !isStalkerSeriesItem(raw ?? {})) {
        return null;
    }
    const id = firstNonBlankStalkerIdText(
        unified ? item.stalkerId : item.xtream_id,
        raw?.id,
        raw?.stream_id,
        raw?.series_id,
        raw?.movie_id
    );
    if (Number(id) !== seriesId) return null;
    const mode = dashboardStalkerSeriesMode(raw);

    const series: UnifiedCollectionItem = unified
        ? { ...item, contentType: 'series', stalkerId: id }
        : {
              uid: dashboardStalkerSeriesKey(playlistId, id, mode),
              sourceType: 'stalker',
              contentType: 'series',
              name: item.title,
              playlistId,
              playlistName: item.playlist_name ?? '',
              stalkerId: id,
              stalkerItem: raw,
              posterUrl: item.poster_url,
          };
    return {
        provider: 'stalker',
        mode,
        playlistId,
        seriesId,
        item: series,
        playlist: { ...playlist, portalUrl },
    };
}

export function dashboardStalkerSeriesMode(
    raw: StalkerPortalItem | undefined
): DashboardStalkerSeriesMode {
    return stalkerSecondStreamType({
        contentType: 'series',
        stalkerItem: raw,
    }) === 'series'
        ? 'regular'
        : isStalkerSeriesFlag(raw?.is_series)
          ? 'lazy'
          : 'embedded';
}

export function dashboardStalkerSeriesKey(
    playlistId: string,
    id: string | number,
    mode: DashboardStalkerSeriesMode
): string {
    return JSON.stringify(['stalker', playlistId, mode, String(id).trim()]);
}

export function dashboardSeriesEpisodesKey(
    playlistId: string,
    seriesId: number
): string {
    return `${playlistId}::${seriesId}`;
}

export function dashboardSeriesEpisodesRequestKey(
    request: DashboardSeriesEpisodesRequest
): string {
    return request.provider === 'stalker'
        ? dashboardStalkerSeriesKey(
              request.playlistId,
              request.item.stalkerId ?? request.seriesId,
              request.mode
          )
        : dashboardSeriesEpisodesKey(request.playlistId, request.seriesId);
}

/** Stalker regular and VOD ids can overlap, even in one playlist. */
export function ambiguousDashboardStalkerSeriesParents(
    items: readonly (PortalActivityItem | UnifiedCollectionItem)[]
): ReadonlySet<string> {
    const modes = new Map<string, DashboardStalkerSeriesMode>();
    const ambiguous = new Set<string>();
    for (const item of items) {
        const unified = 'sourceType' in item;
        if ((unified ? item.sourceType : item.source) !== 'stalker') continue;
        const raw = (unified ? item.stalkerItem : item.stalker_item) as
            StalkerPortalItem | undefined;
        const kind = unified
            ? item.contentType
            : resolvePortalActivityWatchKind(item);
        if (
            kind === 'live' ||
            (kind !== 'series' && !isStalkerSeriesItem(raw ?? {}))
        )
            continue;
        const parentId = Number(unified ? item.stalkerId : item.xtream_id);
        if (!Number.isSafeInteger(parentId) || parentId <= 0) continue;
        const key = dashboardSeriesEpisodesKey(
            unified ? item.playlistId : item.playlist_id,
            parentId
        );
        const mode = dashboardStalkerSeriesMode(raw);
        const previous = modes.get(key);
        if (previous && previous !== mode) ambiguous.add(key);
        modes.set(key, mode);
    }
    return ambiguous;
}

/** Another server or account is another catalog. */
export function dashboardSeriesEpisodesSource(
    request: DashboardSeriesEpisodesRequest
): string {
    if (request.provider === 'stalker') {
        const { playlist } = request;
        return JSON.stringify([
            'stalker',
            playlist.portalUrl,
            stalkerIdentityFingerprint(playlist),
            playlist.username,
            playlist.password,
            playlist.isFullStalkerPortal,
            playlist.updateDate,
            playlist.userAgent?.trim() || undefined,
            playlist.referrer?.trim() || undefined,
            playlist.origin?.trim() || undefined,
        ]);
    }
    return JSON.stringify([
        'xtream',
        request.credentials.serverUrl,
        request.credentials.username,
        request.credentials.userAgent?.trim() || undefined,
    ]);
}

export function dashboardSeriesEpisodesPassword(
    request: DashboardSeriesEpisodesRequest
): string | undefined {
    return request.provider === 'stalker'
        ? undefined
        : request.credentials.password;
}

/** Same series, source, credentials, refresh hint and order. */
export function sameDashboardSeriesEpisodesRequests(
    requestsA: readonly DashboardSeriesEpisodesRequest[],
    requestsB: readonly DashboardSeriesEpisodesRequest[]
): boolean {
    return (
        requestsA.length === requestsB.length &&
        requestsA.every((a, index) => {
            const b = requestsB[index];
            return (
                dashboardSeriesEpisodesRequestKey(a) ===
                    dashboardSeriesEpisodesRequestKey(b) &&
                dashboardSeriesEpisodesSource(a) ===
                    dashboardSeriesEpisodesSource(b) &&
                dashboardSeriesEpisodesPassword(a) ===
                    dashboardSeriesEpisodesPassword(b) &&
                !!a.refresh === !!b.refresh
            );
        })
    );
}
