import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import { isProviderOnlyDetailState } from '@iptvnator/portal/shared/util';
import {
    resolveXtreamVodPlaybackSource,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import {
    getXtreamVodInfo,
    XtreamCategory,
    XtreamVodDetails,
    XtreamVodStream,
} from '@iptvnator/shared/interfaces';
import {
    buildXtreamVodFallbackViewModel,
    hasUsableXtreamVodMetadata,
} from './vod-details-fallback.util';
import { resolveVodMultiSourceMovie } from './vod-multi-source-identity';

type XtreamVodIdentityItem = XtreamVodDetails & {
    readonly id?: number | string;
    readonly stream_id?: number | string;
    readonly xtream_id?: number | string;
};

function resolveVodIdentity(item: XtreamVodDetails): number | null {
    const candidate = item as XtreamVodIdentityItem;
    const value =
        item.movie_data?.stream_id ??
        candidate.xtream_id ??
        candidate.stream_id ??
        candidate.id;
    const id = typeof value === 'string' ? Number(value) : value;

    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
        ? id
        : null;
}

/**
 * What the VOD details route selects: the movie the params address, as the
 * store, the loaded catalog and the route's category describe it. Read-only
 * derivations of the route and the store, shared by the page and the
 * services it binds.
 */
@Injectable()
export class VodDetailsSelectionService {
    private readonly route = inject(ActivatedRoute);
    private readonly xtreamStore = inject(XtreamStore);

    /**
     * Reactive route params: the component is reused when navigating
     * between two VOD details (e.g. via the Similar rail), so computeds
     * must not read the one-shot snapshot.
     */
    private readonly routeParams = toSignal(this.route.params, {
        initialValue: this.route.snapshot.params,
    });

    readonly selectedVodId = computed(() =>
        Number(this.routeParams()['vodId'])
    );
    readonly playbackSessionKey = computed(() => {
        const sourceId = this.xtreamStore.currentPlaylist()?.id;
        const contentId = this.selectedVodId();
        return sourceId && Number.isFinite(contentId) && contentId > 0
            ? createPlaybackSessionKey({ kind: 'vod', sourceId, contentId })
            : '';
    });
    readonly providerOnly = computed(() => {
        this.routeParams();
        return isProviderOnlyDetailState(window.history.state);
    });
    readonly selectedItem = computed(() => {
        const item =
            this.xtreamStore.selectedItem() as unknown as XtreamVodDetails | null;

        return item && resolveVodIdentity(item) === this.selectedVodId()
            ? item
            : null;
    });
    private readonly scopedVodCategories = computed(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        return playlistId &&
            this.xtreamStore.vodCategoriesPlaylistId() === playlistId
            ? this.xtreamStore.vodCategories()
            : [];
    });
    private readonly scopedVodStreams = computed(() => {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        return playlistId &&
            this.xtreamStore.vodStreamsPlaylistId() === playlistId
            ? this.xtreamStore.vodStreams()
            : [];
    });
    readonly selectedCategory = computed<Partial<XtreamCategory> | null>(() => {
        const categoryId = this.routeParams()['categoryId'];
        if (!categoryId) {
            return null;
        }

        return (
            this.scopedVodCategories().find(
                (category) =>
                    String(
                        (
                            category as XtreamCategory & {
                                id?: string | number;
                            }
                        ).category_id ??
                            (
                                category as XtreamCategory & {
                                    id?: string | number;
                                }
                            ).id
                    ) === String(categoryId)
            ) ?? null
        );
    });
    readonly selectedCatalogItem = computed<
        | (Partial<XtreamVodStream> & {
              id?: string | number;
              poster_url?: string;
              title?: string;
              xtream_id?: string | number;
          })
        | null
    >(() => {
        const vodId = this.selectedVodId();
        if (!Number.isFinite(vodId) || vodId <= 0) {
            return null;
        }

        return (
            this.scopedVodStreams().find(
                (item) =>
                    Number(
                        (
                            item as XtreamVodStream & {
                                id?: string | number;
                                xtream_id?: string | number;
                            }
                        ).xtream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).stream_id ??
                            (
                                item as XtreamVodStream & {
                                    id?: string | number;
                                }
                            ).id
                    ) === vodId
            ) ?? null
        );
    });
    /** Movie identity for multi-source discovery; null until a title exists */
    readonly multiSourceMovie = computed(() => {
        // Electron stores categories under `name`, the live API under
        // `category_name` — the same duality the fallback view reads.
        const category = this.selectedCategory() as {
            name?: string;
            category_name?: string;
        } | null;

        return resolveVodMultiSourceMovie({
            playlistId: this.xtreamStore.currentPlaylist()?.id,
            // `title` is the alias the Xtream data source actually writes
            // (createPlaylist maps name -> title), so reading only `name`
            // would fall back to the raw playlist UUID in the sources list.
            playlistName:
                this.xtreamStore.currentPlaylist()?.name ??
                this.xtreamStore.currentPlaylist()?.title,
            vodId: this.selectedVodId(),
            vodInfo: this.selectedVodInfo(),
            catalogItem: this.selectedCatalogItem(),
            containerExtension:
                this.selectedItem()?.movie_data?.container_extension,
            categoryName: category?.name ?? category?.category_name ?? null,
        });
    });
    readonly selectedVodInfo = computed(() => {
        const item = this.selectedItem();
        return item && hasUsableXtreamVodMetadata(item)
            ? getXtreamVodInfo(item)
            : null;
    });
    readonly playableVodItem = computed(() => {
        const item = this.selectedItem();
        return item && resolveXtreamVodPlaybackSource(item) ? item : null;
    });
    readonly fallbackView = computed(() => {
        const item = this.selectedItem();
        if (!item || this.selectedVodInfo()) {
            return null;
        }

        return buildXtreamVodFallbackViewModel({
            vodDetails: item,
            catalogItem: this.selectedCatalogItem(),
            category: this.selectedCategory(),
            vodId: this.selectedVodId(),
        });
    });
    /** `playlist:vod`: the hero keys its one-time layout decision on it. */
    readonly contentKey = computed(
        () =>
            `xtream-vod:${this.xtreamStore.currentPlaylist()?.id ?? ''}:${this.selectedVodId()}`
    );
}
