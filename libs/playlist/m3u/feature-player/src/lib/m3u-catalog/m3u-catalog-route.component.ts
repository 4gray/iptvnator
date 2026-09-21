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
import { Channel, foldSearchText } from '@iptvnator/shared/interfaces';
import { M3uContentKind } from '@iptvnator/shared/m3u-utils';
import { toM3uCatalogCard } from './m3u-catalog-card.util';

/** How many cards are rendered before the first scroll append. */
const INITIAL_WINDOW = 60;
const WINDOW_STEP = 60;

/**
 * The Movies and Series sections of an M3U playlist.
 *
 * One component serves both: the only difference is which content kind it
 * reads out of the catalog index, which arrives as route data. The layout
 * mirrors the portal catalogs on purpose — a group rail on the left, a
 * poster grid on the right — so an M3U playlist with films browses the same
 * way an Xtream one does.
 *
 * This is a full-page route rather than a tab inside the channel-list
 * container, and deliberately so: a poster grid has nothing in common with
 * that container's resizable-rail-and-virtual-scroll machinery, and both
 * of the files it would have to grow are already over the size limit.
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

    protected readonly groups = computed(() =>
        this.catalog.index().groupsByKind[this.kind()]
    );

    protected readonly categoryItems = computed(() =>
        this.groups().map((group) => ({
            id: group.title,
            name: group.title,
            count: group.channels.length,
        }))
    );

    /**
     * Search spans the whole kind, not the selected group. A viewer looking
     * for a film does not know which of 45 groups the provider filed it
     * under, and the group rail stays visible so the result is still
     * placeable.
     */
    protected readonly rows = computed<readonly Channel[]>(() => {
        const term = foldSearchText(this.searchTerm().trim());
        if (term) {
            return this.catalog
                .index()
                .byKind[this.kind()].filter((channel) =>
                    foldSearchText(channel.name ?? '').includes(term)
                );
        }

        const selected = this.selectedGroup();
        const group = this.groups().find((item) => item.title === selected);
        return group?.channels ?? [];
    });

    protected readonly cards = computed(() => {
        const strip = this.settingsStore.stripCountryPrefix() === true;
        return this.rows()
            .slice(0, this.windowSize())
            .map((channel) => toM3uCatalogCard(channel, strip));
    });

    protected readonly hasMore = computed(
        () => this.windowSize() < this.rows().length
    );

    protected readonly isEmpty = computed(
        () => this.catalog.index().counts[this.kind()] === 0
    );

    protected readonly emptyTitleKey = computed(() =>
        this.kind() === 'movie'
            ? 'CHANNELS.CATALOG.NO_MOVIES'
            : 'CHANNELS.CATALOG.NO_SERIES'
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
     * Activating a card hands the row to the existing player route, which
     * already decides between the movie detail shell and inline playback.
     * Nothing new is introduced here: the catalog is a way in, not a second
     * playback path.
     */
    protected onCardActivated(card: { channelUrl?: unknown }): void {
        const url = typeof card.channelUrl === 'string' ? card.channelUrl : '';
        const channel = this.rows().find((row) => row.url === url);
        if (!channel) {
            return;
        }

        this.store.dispatch(ChannelActions.setActiveChannel({ channel }));
        void this.router.navigate(['../all'], { relativeTo: this.route });
    }
}
