import { normalizeContentMetadataPatch } from '@iptvnator/shared/interfaces';
import { inject, Injector, signal } from '@angular/core';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    type IXtreamDataSource,
    type XtreamPlayedContent,
    type XtreamDetailMetadataSource,
    xtreamDetailContentMetadata,
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';

export interface XtreamRecentItemRequest {
    readonly xtreamId: number | string;
    readonly contentType: 'live' | 'movie' | 'series';
    readonly backdropUrl?: string;
    readonly playedContent?: XtreamPlayedContent;
}

/**
 * Records Xtream content as recently viewed once `streamUrl` has really
 * played — inline for a couple of seconds, or launched in MPV/VLC — so a
 * source that fails straight away never reaches history or the dashboard
 * hero. The playlist is captured when playback starts, so navigating to
 * another one meanwhile cannot misfile the item.
 *
 * A confirmation that arrives after the user switched to another playlist
 * (only a slow MPV/VLC launch can: the inline player goes with the page) is
 * saved to the captured playlist without touching the store, whose recent
 * list belongs to the other playlist by then.
 *
 * Must run in an injection context.
 */
export function injectXtreamRecentHistory(): (
    streamUrl: string,
    request: XtreamRecentItemRequest,
    sessionKey?: string
) => void {
    const gate = inject(PlaybackHistoryGate);
    const store = inject(XtreamStore);
    const injector = inject(Injector);

    return (streamUrl, request, sessionKey) => {
        const playlist = signal(store.currentPlaylist()).asReadonly();
        const captured = {
            ...request,
            ...(request.playedContent
                ? { playedContent: { ...request.playedContent } }
                : {}),
        };
        gate.defer({ sessionKey, streamUrls: [streamUrl] }, () => {
            const playlistId = playlist()?.id;
            if (store.currentPlaylist()?.id === playlistId) {
                store.addRecentItem({ ...captured, playlist });
            } else if (playlistId) {
                void saveWithoutListRefresh(
                    injector.get(XTREAM_DATA_SOURCE),
                    // The data source factory picks SQLite by this contract,
                    // not by a generic Electron bridge.
                    !injector.get(RuntimeCapabilitiesService)
                        .supportsXtreamSqliteDataSource,
                    playlistId,
                    captured
                );
            }
        });
    };
}

/**
 * The save half of `withRecentItems.addRecentItem` (same content lookup;
 * the API-only data source keys cold content by its Xtream id), without
 * reloading the store's recent list. Kept here rather than shared with the store: the
 * store and its library barrel ship in the initial bundle, this path is
 * only reached from lazy detail pages.
 */
async function saveWithoutListRefresh(
    dataSource: IXtreamDataSource,
    keysByXtreamId: boolean,
    playlistId: string,
    {
        xtreamId,
        contentType,
        backdropUrl,
        playedContent,
    }: XtreamRecentItemRequest
): Promise<void> {
    const id = Number(xtreamId);
    if (!Number.isFinite(id) || id <= 0) {
        return;
    }
    const identity = playedContent
        ? normalizeContentMetadataPatch({
              tmdbId: playedContent.tmdbId ?? undefined,
              releaseYear: playedContent.releaseYear ?? undefined,
          })
        : null;
    const content = await dataSource.getContentByXtreamId(
        id,
        playlistId,
        contentType,
        ...(!keysByXtreamId && identity ? [identity] : [])
    );
    const contentId = content?.id ?? (keysByXtreamId ? id : null);
    if (contentId != null) {
        await dataSource.addRecentItem(
            { id: contentId, type: contentType },
            playlistId,
            backdropUrl,
            ...(playedContent ? ([playedContent] as const) : [])
        );
    }
}

/** Capture displayed detail metadata before playback confirmation or navigation. */
export function xtreamPlayedDetail(
    info:
        | (XtreamDetailMetadataSource & {
              name?: string;
              cover?: string;
              movie_image?: string;
              cover_big?: string;
              category_id?: string;
          })
        | null
        | undefined,
    fallbackTitle?: string,
    fallbackPoster?: string | null
): XtreamPlayedContent | undefined {
    const title = info?.name || fallbackTitle;
    if (!title) return undefined;
    return {
        ...xtreamDetailContentMetadata(info),
        title,
        posterUrl:
            info?.cover ||
            info?.movie_image ||
            info?.cover_big ||
            fallbackPoster ||
            undefined,
        categoryId: info?.category_id,
    };
}
