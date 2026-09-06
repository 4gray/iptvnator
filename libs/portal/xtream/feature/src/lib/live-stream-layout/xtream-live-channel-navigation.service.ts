import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationStart, Router } from '@angular/router';
import { LiveChannelPlaybackQueue } from '@iptvnator/portal/shared/data-access';
import {
    LiveLayoutSidebarStateService,
    PortalChannelSortMode,
    queryParamSignal,
    sortPortalChannelItems,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';

export interface XtreamLiveChannelItem {
    readonly added?: string;
    readonly category_id?: string | number;
    readonly last_modified?: string;
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly title?: string;
    readonly tv_archive?: number | null;
    readonly tv_archive_duration?: number | string | null;
    readonly xtream_id: number;
}

/** Browse state is independent from the ordered list that started playback. */
@Injectable()
export class XtreamLiveChannelNavigationService {
    private readonly store = inject(XtreamStore);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly sidebar = inject(LiveLayoutSidebarStateService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly queue =
        new LiveChannelPlaybackQueue<XtreamLiveChannelItem>(
            (item) => item.xtream_id
        );
    private readonly playing = signal<{
        owner: string;
        item: XtreamLiveChannelItem;
    } | null>(null);
    readonly sortMode = signal<PortalChannelSortMode>('server');
    private readonly query = queryParamSignal(this.route, 'q', (q) => q ?? '');
    private readonly owner = computed(() =>
        this.store.selectedContentType() === 'live'
            ? `${this.store.currentPlaylist()?.id ?? ''}:live`
            : ''
    );
    readonly activeItem = computed(() => {
        const playing = this.playing();
        return playing?.owner === this.owner() ? playing.item : null;
    });
    readonly displayedChannels = computed(() => {
        const term = this.query().trim().toLowerCase();
        const channels = sortPortalChannelItems(
            this.store.selectItemsFromSelectedCategory() as XtreamLiveChannelItem[],
            this.sortMode(),
            (item) => item.title ?? item.name
        );
        return term
            ? channels.filter((item) =>
                  `${item.title ?? ''} ${item.name ?? ''}`
                      .toLowerCase()
                      .includes(term)
              )
            : channels;
    });
    private readonly accessibleChannels = computed(() => {
        const categories = new Set(
            this.store
                .getCategoriesBySelectedType()
                .filter(
                    (category) => !('hidden' in category && category.hidden)
                )
                .map((category) => Number(category.category_id ?? category.id))
        );
        return (this.store.liveStreams() as XtreamLiveChannelItem[]).filter(
            (item) => categories.has(Number(item.category_id))
        );
    });
    readonly remoteChannels = computed(() => {
        const available = new Map(
            this.accessibleChannels().map((item) => [
                Number(item.xtream_id),
                item,
            ])
        );
        return this.queue
            .items(this.owner())
            .map((item) => available.get(Number(item.xtream_id)))
            .filter(
                (item): item is XtreamLiveChannelItem => item !== undefined
            );
    });
    readonly canReveal = computed(() => {
        const active = this.activeItem();
        return (
            !!active &&
            this.accessibleChannels().some(
                (item) => Number(item.xtream_id) === Number(active.xtream_id)
            ) &&
            !this.displayedChannels().some(
                (item) => Number(item.xtream_id) === Number(active.xtream_id)
            )
        );
    });
    private readonly pendingReveal = signal<{
        channelId: number;
        categoryId: number;
        sequence: number;
    } | null>(null);
    readonly revealRequest = computed(() => {
        const request = this.pendingReveal();
        return request &&
            request.channelId === this.activeItem()?.xtream_id &&
            request.categoryId === this.store.selectedCategoryId() &&
            !this.query().trim()
            ? request
            : null;
    });
    private requestSequence = 0;
    private navigationGeneration = 0;

    constructor() {
        let previousOwner = this.owner();
        effect(() => {
            const owner = this.owner();
            if (owner !== previousOwner) {
                previousOwner = owner;
                untracked(() => {
                    this.queue.clear();
                    this.playing.set(null);
                    this.pendingReveal.set(null);
                    this.requestSequence++;
                });
            }
        });
        this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
            if (event instanceof NavigationStart) {
                this.navigationGeneration++;
                this.pendingReveal.set(null);
            }
        });
    }

    /** History handoffs carry an item, not a browsed list or its old filter. */
    channelsForAutoOpen(
        item: XtreamLiveChannelItem
    ): readonly XtreamLiveChannelItem[] {
        return sortPortalChannelItems(
            this.accessibleChannels().filter(
                (channel) =>
                    Number(channel.category_id) === Number(item.category_id)
            ),
            this.sortMode(),
            (channel) => channel.title ?? channel.name
        );
    }

    capture(
        item: XtreamLiveChannelItem,
        items: readonly XtreamLiveChannelItem[] = this.displayedChannels(),
        preserveQueue = false
    ): void {
        this.requestSequence++;
        this.pendingReveal.set(null);
        const owner = this.owner();
        if (!preserveQueue && this.activeItem()?.xtream_id !== item.xtream_id) {
            this.queue.capture(
                owner,
                JSON.stringify([
                    this.store.selectedCategoryId(),
                    this.query(),
                    this.sortMode(),
                ]),
                items,
                item
            );
        }
        this.playing.set({ owner, item });
    }

    async reveal(): Promise<void> {
        if (!this.canReveal()) return;
        const active = this.activeItem();
        const target = this.accessibleChannels().find(
            (item) => item.xtream_id === active?.xtream_id
        );
        if (!target) return;
        const categoryId = Number(target.category_id);
        const owner = this.owner();
        const sequence = ++this.requestSequence;
        const previousCategory = this.store.selectedCategoryId();
        const generation = this.navigationGeneration;
        const routeCategoryId = this.route.snapshot.params?.['categoryId'];
        const needsNavigation =
            this.query() ||
            this.route.snapshot.queryParamMap.has('q') ||
            (routeCategoryId && Number(routeCategoryId) !== categoryId);
        // Root category browsing is store-only: Angular reports a same-URL
        // navigation as false, even though there is nothing to cancel.
        const navigation = needsNavigation
            ? this.router.navigate(routeCategoryId ? ['../', categoryId] : [], {
                  relativeTo: this.route,
                  queryParams: { q: null },
                  queryParamsHandling: 'merge',
              })
            : Promise.resolve(true);
        try {
            const navigated = await navigation;
            if (
                navigated === false ||
                this.destroyRef.destroyed ||
                sequence !== this.requestSequence ||
                owner !== this.owner() ||
                this.navigationGeneration > generation + 1 ||
                this.activeItem()?.xtream_id !== target.xtream_id ||
                !this.accessibleChannels().some(
                    (item) => item.xtream_id === target.xtream_id
                ) ||
                (this.store.selectedCategoryId() !== previousCategory &&
                    this.store.selectedCategoryId() !== categoryId)
            )
                return;
            this.store.setCategorySearchTerm('');
            this.store.setSelectedCategory(categoryId);
            this.sidebar.setState('expanded');
            this.pendingReveal.set({
                channelId: target.xtream_id,
                categoryId,
                sequence,
            });
        } catch {
            // Cancelled/failed navigation leaves playback and browse state intact.
        }
    }
}
