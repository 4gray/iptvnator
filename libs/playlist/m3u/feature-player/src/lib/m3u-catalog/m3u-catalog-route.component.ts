import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    inject,
    linkedSignal,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelActions, M3uCatalogIndexService } from '@iptvnator/m3u-state';
import {
    CategoryViewComponent,
    GridListComponent,
    InfiniteScrollDirective,
    PortalEmptyStateComponent,
} from '@iptvnator/portal/shared/ui';
import { SettingsStore } from '@iptvnator/services';
import { foldSearchText } from '@iptvnator/shared/interfaces';
import { M3uContentKind } from '@iptvnator/shared/m3u-utils';
import {
    M3uCatalogCard,
    toM3uCatalogCard,
    toM3uSeriesCard,
} from './m3u-catalog-card.util';

/** How many cards are rendered before the first scroll append. */
const INITIAL_WINDOW = 60;
const WINDOW_STEP = 60;

interface CatalogGroup {
    readonly title: string;
    readonly count: number;
}

/**
 * The Movies and Series sections of an M3U playlist.
 *
 * One component serves both; the kind arrives as route data. The layout
 * mirrors the portal catalogs on purpose — a group rail on the left, a
 * poster grid on the right — so an M3U playlist with films browses the same
 * way an Xtream one does.
 *
 * The two kinds differ in what a card IS. Movies are rows, and a card opens
 * the player. Series are aggregates, and a card opens a detail page — the
 * Series section shows 1,953 shows rather than the 40,327 episode rows they
 * are made of, which is the entire point of aggregating them.
 *
 * This is a full-page route rather than a tab inside the channel-list
 * container, and deliberately so: a poster grid shares nothing with that
 * container's resizable-rail and virtual-scroll machinery, and both files it
 * would have to grow are already over the size limit.
 */
@Component({
    selector: 'app-m3u-catalog-route',
    imports: [
        CategoryViewComponent,
        GridListComponent,
        InfiniteScrollDirective,
        PortalEmptyStateComponent,
        TranslatePipe,
    ],
    templateUrl: './m3u-catalog-route.component.html',
    styleUrls: ['./m3u-catalog-route.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uCatalogRouteComponent {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly catalog = inject(M3uCatalogIndexService);
    private readonly settingsStore = inject(SettingsStore);

    /** `movie` or `episode`, supplied by the route definition. */
    protected readonly kind = signal<M3uContentKind>(
        (this.route.snapshot.data['kind'] as M3uContentKind) ?? 'movie'
    );

    protected readonly isSeries = computed(() => this.kind() === 'episode');

    /**
     * The workspace header owns search for this route's `local-filter`
     * mode and publishes it as `?q=`, so the component reads it rather than
     * rendering a second search box.
     */
    protected readonly searchTerm = toSignal(
        this.route.queryParamMap.pipe(map((params) => params.get('q') ?? '')),
        { initialValue: '' }
    );

    protected readonly selectedGroup = signal<string | null>(null);

    /**
     * The render window resets whenever the visible set changes, so a
     * viewer who scrolled deep into one group does not land mid-way down
     * the next one.
     */
    private readonly windowSize = linkedSignal({
        source: () =>
            `${this.kind()}\u0000${this.selectedGroup()}\u0000${this.searchTerm()}`,
        computation: () => INITIAL_WINDOW,
    });

    protected readonly groups = computed<readonly CatalogGroup[]>(() => {
        if (!this.isSeries()) {
            return this.catalog
                .index()
                .groupsByKind[this.kind()].map((group) => ({
                    title: group.title,
                    count: group.channels.length,
                }));
        }

        // A series belongs to the group most of its episodes sit in, so the
        // rail counts shows rather than episode rows.
        const counts = new Map<string, number>();
        for (const series of this.catalog.series()) {
            counts.set(
                series.primaryGroup,
                (counts.get(series.primaryGroup) ?? 0) + 1
            );
        }
        return [...counts].map(([title, count]) => ({ title, count }));
    });

    protected readonly categoryItems = computed(() =>
        this.groups().map((group) => ({
            id: group.title,
            name: group.title,
            count: group.count,
        }))
    );

    /**
     * Search spans the whole section, not the selected group. A viewer
     * looking for a film does not know which of forty-five groups the
     * provider filed it under, and the group rail stays visible so the
     * result is still placeable.
     */
    private readonly allCards = computed<readonly M3uCatalogCard[]>(() => {
        if (this.isSeries()) {
            return this.catalog.series().map(toM3uSeriesCard);
        }

        // Optional in the Settings shape, so the store's signal is too.
        const strip = this.settingsStore.stripCountryPrefix?.() === true;
        return this.catalog
            .index()
            .byKind[this.kind()].map((channel) =>
                toM3uCatalogCard(channel, strip)
            );
    });

    private readonly groupOfCard = computed<ReadonlyMap<string, string>>(() => {
        const map = new Map<string, string>();
        if (this.isSeries()) {
            for (const series of this.catalog.series()) {
                map.set(`series:${series.id}`, series.primaryGroup);
            }
            return map;
        }

        for (const group of this.catalog.index().groupsByKind[this.kind()]) {
            for (const channel of group.channels) {
                map.set(channel.url, group.title);
            }
        }
        return map;
    });

    protected readonly matches = computed<readonly M3uCatalogCard[]>(() => {
        const term = foldSearchText(this.searchTerm().trim());
        if (term) {
            return this.allCards().filter((card) =>
                foldSearchText(card.name).includes(term)
            );
        }

        const selected = this.selectedGroup();
        const lookup = this.groupOfCard();
        return this.allCards().filter(
            (card) => lookup.get(card.id) === selected
        );
    });

    protected readonly cards = computed(() =>
        this.matches().slice(0, this.windowSize())
    );

    protected readonly hasMore = computed(
        () => this.windowSize() < this.matches().length
    );

    protected readonly isEmpty = computed(() => this.allCards().length === 0);

    protected readonly emptyTitleKey = computed(() =>
        this.isSeries()
            ? 'CHANNELS.CATALOG.NO_SERIES'
            : 'CHANNELS.CATALOG.NO_MOVIES'
    );

    constructor() {
        // Selecting the first group keeps the grid populated on arrival; the
        // portals do the same rather than opening on an empty pane.
        effect(() => {
            const groups = this.groups();
            const selected = this.selectedGroup();
            if (
                groups.length > 0 &&
                !groups.some((group) => group.title === selected)
            ) {
                this.selectedGroup.set(groups[0].title);
            }
        });
    }

    protected onGroupSelected(item: { id?: string | number }): void {
        this.selectedGroup.set(String(item.id ?? ''));
    }

    protected onLoadMore(): void {
        this.windowSize.update((size) => size + WINDOW_STEP);
    }

    /**
     * A series card opens its detail page; a movie card hands the row to the
     * existing player route, which already decides between the movie detail
     * shell and inline playback. Nothing new is introduced here: the catalog
     * is a way in, not a second playback path.
     */
    protected onCardActivated(card: Record<string, unknown>): void {
        const seriesId = card['seriesId'];
        if (typeof seriesId === 'number') {
            void this.router.navigate(['..', 'series', seriesId], {
                relativeTo: this.route,
            });
            return;
        }

        const raw = card['channelUrl'];
        const url = typeof raw === 'string' ? raw : '';
        const channel = this.catalog
            .index()
            .byKind[this.kind()].find((row) => row.url === url);
        if (!channel) {
            return;
        }

        this.store.dispatch(ChannelActions.setActiveChannel({ channel }));
        void this.router.navigate(['../all'], { relativeTo: this.route });
    }
}
