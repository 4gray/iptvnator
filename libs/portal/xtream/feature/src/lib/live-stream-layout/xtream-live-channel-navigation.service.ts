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
import { foldSearchText } from '@iptvnator/shared/interfaces';

export interface XtreamLiveChannelItem {
    readonly id?: string | number;
    readonly added?: string;
    readonly category_id?: string | number;
    readonly last_modified?: string;
    readonly name?: string;
    readonly poster_url?: string;
    readonly stream_icon?: string;
    readonly epg_channel_id?: string | null;
    readonly title?: string;
    readonly tmdb_id?: number | null;
    readonly release_year?: number | null;
    readonly tv_archive?: number | null;
    readonly tv_archive_duration?: number | string | null;
    readonly xtream_id: number;
}

type QueuePolicy = 'on-channel-change' | 'preserve' | 'replace';

export function xtreamCategoryKey(
    id: string | number | null | undefined
): string {
    const raw = String(id ?? '').trim();
    const numeric = Number(raw);
    return raw && Number.isFinite(numeric) ? String(numeric) : raw;
}

export function sameXtreamChannelCopy(
    left: XtreamLiveChannelItem,
    right: XtreamLiveChannelItem
): boolean {
    return (
        left.xtream_id === right.xtream_id &&
        xtreamCategoryKey(left.category_id) ===
            xtreamCategoryKey(right.category_id)
    );
}

function channelCopyKey(item: XtreamLiveChannelItem): string {
    return `${item.xtream_id}:${xtreamCategoryKey(item.category_id)}`;
}

function rowsWithActiveCopy(
    items: readonly XtreamLiveChannelItem[],
    active: XtreamLiveChannelItem
): XtreamLiveChannelItem[] {
    return items.filter(
        (item) =>
            item.xtream_id !== active.xtream_id ||
            sameXtreamChannelCopy(item, active)
    );
}

export function replaceXtreamQueuedCopy(
    queue: readonly XtreamLiveChannelItem[],
    item: XtreamLiveChannelItem
): readonly XtreamLiveChannelItem[] {
    return queue.some((entry) => entry.xtream_id === item.xtream_id)
        ? queue.map((entry) =>
              entry.xtream_id === item.xtream_id ? item : entry
          )
        : [item];
}

export function xtreamRowsByStreamId(
    items: readonly XtreamLiveChannelItem[]
): Map<string, XtreamLiveChannelItem> {
    const rows = new Map<string, XtreamLiveChannelItem>();
    for (const item of items) {
        const id = String(item.xtream_id);
        if (!rows.has(id)) rows.set(id, item);
    }
    return rows;
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
        const term = foldSearchText(this.query().trim());
        const channels = sortPortalChannelItems(
            this.store.selectItemsFromSelectedCategory() as XtreamLiveChannelItem[],
            this.sortMode(),
            (item) => item.title ?? item.name
        );
        return term
            ? channels.filter((item) =>
                  foldSearchText(
                      `${item.title ?? ''} ${item.name ?? ''}`
                  ).includes(term)
              )
            : channels;
    });
    private readonly accessibleChannels = computed(() => {
        const categories = new Set(
            this.store
                .getCategoriesBySelectedType()
                .filter(
                    (category) => !('hidden' in category && category['hidden'])
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
                channelCopyKey(item),
                item,
            ])
        );
        return this.queue
            .items(this.owner())
            .map((item) => available.get(channelCopyKey(item)))
            .filter(
                (item): item is XtreamLiveChannelItem => item !== undefined
            );
    });
    readonly canReveal = computed(() => {
        const active = this.activeItem();
        return (
            !!active &&
            this.accessibleChannels().some((item) =>
                sameXtreamChannelCopy(item, active)
            ) &&
            !this.displayedChannels().some((item) =>
                sameXtreamChannelCopy(item, active)
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
        const active = this.activeItem();
        return request &&
            request.channelId === active?.xtream_id &&
            request.categoryId === Number(active.category_id) &&
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
        policy: QueuePolicy = 'on-channel-change'
    ): void {
        this.requestSequence++;
        this.pendingReveal.set(null);
        const owner = this.owner();
        if (this.shouldReplaceQueue(item, policy)) {
            this.queue.capture(
                owner,
                JSON.stringify([
                    this.store.selectedCategoryId(),
                    this.query(),
                    this.sortMode(),
                ]),
                rowsWithActiveCopy(items, item),
                item
            );
        }
        this.playing.set({ owner, item });
    }

    replacePlayingCopy(item: XtreamLiveChannelItem): void {
        const saved = this.queue.items(this.owner());
        this.capture(item, replaceXtreamQueuedCopy(saved, item), 'replace');
    }

    queueFor(
        item: XtreamLiveChannelItem,
        items: readonly XtreamLiveChannelItem[],
        policy: QueuePolicy = 'on-channel-change'
    ): readonly XtreamLiveChannelItem[] {
        if (!this.shouldReplaceQueue(item, policy))
            return this.queue.items(this.owner());
        const rows = xtreamRowsByStreamId(rowsWithActiveCopy(items, item));
        return rows.has(String(item.xtream_id)) ? [...rows.values()] : [item];
    }

    private shouldReplaceQueue(
        item: XtreamLiveChannelItem,
        policy: QueuePolicy
    ): boolean {
        const active = this.activeItem();
        return (
            policy === 'replace' ||
            (policy === 'on-channel-change' &&
                (!active || !sameXtreamChannelCopy(active, item)))
        );
    }

    async reveal(): Promise<void> {
        if (!this.canReveal()) return;
        const active = this.activeItem();
        if (!active) return;
        const target = this.accessibleChannels().find((item) =>
            sameXtreamChannelCopy(item, active)
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
            const current = this.activeItem();
            if (
                navigated === false ||
                this.destroyRef.destroyed ||
                sequence !== this.requestSequence ||
                owner !== this.owner() ||
                this.navigationGeneration > generation + 1 ||
                !current ||
                !sameXtreamChannelCopy(current, target) ||
                !this.accessibleChannels().some((item) =>
                    sameXtreamChannelCopy(item, target)
                ) ||
                (this.store.selectedCategoryId() !== previousCategory &&
                    this.store.selectedCategoryId() !== categoryId)
            )
                return;
            this.store.setCategorySearchTerm('');
            this.store.setSelectedCategory(categoryId);
            this.sidebar.expand('portal');
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
