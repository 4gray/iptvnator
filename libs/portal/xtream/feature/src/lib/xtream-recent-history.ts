import {
    captureHistoryOwner,
    XtreamHistoryOrder,
} from '@iptvnator/services/history-events';
import { sourceConnection } from '@iptvnator/services/source-sync/connection';
import { inject, Injector, signal } from '@angular/core';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    type XtreamPlayedContent,
    type XtreamDetailMetadataSource,
    xtreamDetailContentMetadata,
    loadXtreamRecentOperations,
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
    sessionKey?: string,
    launchId?: string
) => void {
    const gate = inject(PlaybackHistoryGate);
    const store = inject(XtreamStore);
    const injector = inject(Injector);
    const historyOrder = inject(XtreamHistoryOrder);

    return (streamUrl, request, sessionKey, launchId) => {
        const playlist = signal(store.currentPlaylist()).asReadonly();
        const captured = {
            ...request,
            ...(request.playedContent
                ? { playedContent: { ...request.playedContent } }
                : {}),
        };
        gate.defer(
            {
                sourceId: playlist()?.id,
                sessionKey,
                launchId,
                streamUrls: [streamUrl],
            },
            () => {
                const playlistId = playlist()?.id;
                if (store.currentPlaylist()?.id === playlistId) {
                    store.addRecentItem({ ...captured, playlist });
                } else if (playlistId) {
                    const current = captureHistoryOwner(
                        sourceConnection()?.instanceId,
                        playlistId,
                        () => sourceConnection()?.instanceId
                    );
                    const dataSource = injector.get(XTREAM_DATA_SOURCE);
                    const sqlite = injector.get(
                        RuntimeCapabilitiesService
                    ).supportsXtreamSqliteDataSource;
                    const write = async () => {
                        const { saveXtreamRecent } =
                            await loadXtreamRecentOperations();
                        await saveXtreamRecent(
                            dataSource,
                            sqlite,
                            { ...captured, playlistId },
                            current
                        );
                    };
                    void (sqlite
                        ? historyOrder.run(
                              playlistId,
                              write,
                              captured.contentType === 'live'
                                  ? playlistId
                                  : undefined
                          )
                        : write());
                }
            }
        );
    };
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
