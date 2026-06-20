import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    ContentCardComponent,
    ContentRailShellComponent,
} from '@iptvnator/portal/shared/ui';
import { toXtreamRecentlyAddedTimestamp } from '@iptvnator/shared/interfaces';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ContentType } from '@iptvnator/portal/xtream/data-access';

interface RecentlyAddedItem {
    readonly added?: string;
    readonly category_id: string | number;
    readonly cover?: string;
    readonly id?: number;
    readonly last_modified?: string;
    readonly name?: string;
    readonly poster_url?: string;
    readonly series_id?: number;
    readonly stream_id?: number;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly xtream_id?: number;
}

// Three placeholder slots per skeleton rail — enough to suggest a horizontal
// scroll without taking the whole viewport.
const SKELETON_CARDS_PER_RAIL = [1, 2, 3, 4, 5, 6] as const;
const RECENTLY_ADDED_ITEMS_LIMIT = 30;

@Component({
    selector: 'app-recently-added',
    templateUrl: './recently-added.component.html',
    styleUrls: ['./recently-added.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ContentCardComponent, ContentRailShellComponent, TranslatePipe],
})
export class RecentlyAddedComponent {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly router = inject(Router);
    private readonly activatedRoute = inject(ActivatedRoute);
    private readonly translate = inject(TranslateService);
    // Re-compute translated labels when the active language changes.
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

    readonly recentlyAddedLive = computed(() =>
        this.getRecentlyAdded(
            this.xtreamStore.liveStreams() as RecentlyAddedItem[]
        )
    );
    readonly recentlyAddedVod = computed(() =>
        this.getRecentlyAdded(
            this.xtreamStore.vodStreams() as RecentlyAddedItem[]
        )
    );
    readonly recentlyAddedSeries = computed(() =>
        this.getRecentlyAdded(
            this.xtreamStore.serialStreams() as RecentlyAddedItem[],
            true
        )
    );

    readonly skeletonSlots = SKELETON_CARDS_PER_RAIL;

    readonly totalItems = computed(
        () =>
            this.recentlyAddedVod().length +
            this.recentlyAddedSeries().length +
            this.recentlyAddedLive().length
    );

    /**
     * Show skeleton rails when the store is still fetching AND we have
     * nothing resolved yet. Once a single section has data we drop the
     * skeletons so partial-load states aren't obscured.
     */
    readonly isLoading = computed(() => {
        const store = this.xtreamStore;
        const hasAnyData = this.totalItems() > 0;
        if (hasAnyData) return false;
        return (
            store.isLoadingContent() ||
            store.isLoadingCategories() ||
            store.isImporting()
        );
    });

    // Absolute rail "browse all" routes reuse the active playlist id. The
    // store owns the current playlist, so navigation stays correct even if
    // the user switches playlists before the rails finish loading.
    private readonly playlistId = computed(
        () => this.xtreamStore.currentPlaylist()?.id ?? null
    );

    readonly vodSeeAllLink = computed(() => this.buildSectionLink('vod'));
    readonly seriesSeeAllLink = computed(() => this.buildSectionLink('series'));
    readonly liveSeeAllLink = computed(() => this.buildSectionLink('live'));

    readonly vodSeeAllLabel = computed(() =>
        this.translateWithTick('PORTALS.BROWSE_ALL_MOVIES')
    );
    readonly seriesSeeAllLabel = computed(() =>
        this.translateWithTick('PORTALS.BROWSE_ALL_SERIES')
    );
    readonly liveSeeAllLabel = computed(() =>
        this.translateWithTick('PORTALS.BROWSE_ALL_LIVE')
    );

    private buildSectionLink(
        section: 'vod' | 'series' | 'live'
    ): string[] | null {
        const id = this.playlistId();
        if (!id) return null;
        return ['/workspace', 'xtreams', id, section];
    }

    private translateWithTick(key: string): string {
        this.languageTick();
        return this.translate.instant(key);
    }

    private getRecentlyAdded<T extends RecentlyAddedItem>(
        items: T[],
        isSeries = false
    ): T[] {
        const nowMs = Date.now();

        return items
            .map((item) => ({
                item,
                sortTimestamp: this.getSortTimestamp(item, isSeries, nowMs),
            }))
            .filter(({ sortTimestamp }) => sortTimestamp > 0)
            .sort((a, b) => {
                return b.sortTimestamp - a.sortTimestamp;
            })
            .slice(0, RECENTLY_ADDED_ITEMS_LIMIT)
            .map(({ item }) => item);
    }

    getDate(item: RecentlyAddedItem, isSeries = false): number {
        const nowMs = Date.now();
        return (
            toXtreamRecentlyAddedTimestamp(
                this.getPrimaryTimestamp(item, isSeries),
                nowMs
            ) ||
            toXtreamRecentlyAddedTimestamp(
                this.getFallbackTimestamp(item, isSeries),
                nowMs
            )
        );
    }

    private getSortTimestamp(
        item: RecentlyAddedItem,
        isSeries: boolean,
        nowMs: number
    ): number {
        return (
            toXtreamRecentlyAddedTimestamp(
                this.getPrimaryTimestamp(item, isSeries),
                nowMs
            ) ||
            toXtreamRecentlyAddedTimestamp(
                this.getFallbackTimestamp(item, isSeries),
                nowMs
            )
        );
    }

    private getPrimaryTimestamp(
        item: RecentlyAddedItem,
        isSeries: boolean
    ): string | undefined {
        return isSeries ? item.last_modified : item.added;
    }

    private getFallbackTimestamp(
        item: RecentlyAddedItem,
        isSeries: boolean
    ): string | undefined {
        return isSeries ? item.added : item.last_modified;
    }

    openItem(item: RecentlyAddedItem, type: ContentType) {
        this.xtreamStore.setSelectedContentType(type);

        if (type === 'live') {
            const itemId = this.getItemId(item, type);
            this.router.navigate(['..', type, item.category_id], {
                relativeTo: this.activatedRoute,
                ...(itemId
                    ? {
                          state: {
                              openXtreamLiveItemId: Number(itemId),
                              openXtreamLiveTitle:
                                  item.title || item.name || '',
                              openXtreamLivePoster:
                                  item.poster_url || item.stream_icon || '',
                          },
                      }
                    : {}),
            });
        } else {
            const itemId = this.getItemId(item, type);
            this.router.navigate(['..', type, item.category_id, itemId], {
                relativeTo: this.activatedRoute,
            });
        }
    }

    private getItemId(
        item: RecentlyAddedItem,
        type: ContentType
    ): number | undefined {
        return (
            item.xtream_id ||
            item.id ||
            (type === 'series' ? item.series_id : item.stream_id)
        );
    }
}
