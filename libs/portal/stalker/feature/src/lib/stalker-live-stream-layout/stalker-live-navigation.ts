import {
    computed,
    effect,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { LiveChannelPlaybackQueue } from '@iptvnator/portal/shared/data-access';
import {
    getAdjacentChannelItem,
    getChannelItemByNumber,
    LiveLayoutSidebarStateService,
} from '@iptvnator/portal/shared/util';
import {
    StalkerItvChannel,
    StalkerStore,
    normalizeStalkerEntityId,
} from '@iptvnator/portal/stalker/data-access';

type SelectionContext = Signal<string> | 'preserve' | undefined;
interface LiveNavigationOptions {
    store: InstanceType<typeof StalkerStore>;
    router: Router | null;
    sidebar: LiveLayoutSidebarStateService;
    rows: (panelTerm?: Signal<string>) => StalkerItvChannel[];
    play: (item: StalkerItvChannel) => void;
    revealRow: (id: string) => boolean;
    loading: () => boolean;
}
interface PlayingOrigin {
    owner: string;
    item: StalkerItvChannel;
    categories: ReadonlyMap<string, string>;
    scope: string;
}
interface RevealRequest {
    owner: string;
    id: string;
    category: string;
}

/** Owns live navigation without letting category browsing replace playback order. */
export class StalkerLiveNavigation {
    private readonly queue = new LiveChannelPlaybackQueue<StalkerItvChannel>(
        (item) => item.id
    );
    private readonly origin = signal<PlayingOrigin | null>(null);
    private readonly pendingReveal = signal<RevealRequest | null>(null);
    private readonly revealed = signal<{
        owner: string;
        category: string;
        item: StalkerItvChannel;
    } | null>(null);
    private readonly panelTerm = signal<Signal<string> | undefined>(undefined);
    private ownerSeen = '';
    private generation = 0;
    private revealGeneration = 0;
    private revealTimer: ReturnType<typeof setTimeout> | undefined;
    readonly owner = computed(() =>
        JSON.stringify([
            this.options.store.currentPlaylist()?._id,
            this.options.store.selectedContentType(),
        ])
    );
    readonly channels = computed(() => {
        const captured = this.queue.items(this.owner());
        return captured.length ? [...captured] : this.options.rows();
    });
    readonly canReveal = computed(() => {
        const active = this.activeItem();
        return (
            !!active &&
            !!this.categoryFor(active) &&
            !this.withRevealedItem(this.options.rows()).some(
                (row) => this.id(row) === this.id(active)
            )
        );
    });

    constructor(private readonly options: LiveNavigationOptions) {
        effect(() => {
            const owner = this.owner();
            if (owner !== this.ownerSeen) {
                this.ownerSeen = owner;
                untracked(() => this.reset());
            }
        });
        effect(() => {
            const owner = this.owner();
            const scope = this.scope(this.panelTerm());
            const rows = this.options.rows(this.panelTerm());
            const origin = this.origin();
            if (this.options.loading()) return;
            untracked(() => {
                this.queue.extend(owner, scope, rows);
                if (origin?.owner === owner && origin.scope === scope) {
                    const categories = new Map(origin.categories);
                    for (const row of rows)
                        categories.set(
                            this.id(row),
                            String(
                                row.tv_genre_id ??
                                    row.category_id ??
                                    this.options.store.selectedCategoryId() ??
                                    '*'
                            )
                        );
                    if (categories.size > origin.categories.size)
                        this.origin.set({
                            ...origin,
                            categories,
                        });
                }
            });
        });
        effect(() => {
            const revealed = this.revealed();
            if (
                revealed &&
                (revealed.owner !== this.owner() ||
                    revealed.category !==
                        this.options.store.selectedCategoryId() ||
                    this.options.store.searchPhrase() ||
                    this.id(revealed.item) !== this.id(this.activeItem()))
            )
                this.revealed.set(null);
        });
        effect(() => {
            const request = this.pendingReveal();
            if (!request) return;
            const owner = this.owner();
            const category = this.options.store.selectedCategoryId();
            const query = this.options.store.searchPhrase();
            this.options.rows();
            const loading = this.options.loading();
            untracked(() => {
                if (
                    owner !== request.owner ||
                    category !== request.category ||
                    query ||
                    this.id(this.activeItem()) !== request.id
                ) {
                    this.pendingReveal.set(null);
                    return;
                }
                if (loading) return;
                if (this.revealTimer) clearTimeout(this.revealTimer);
                // Render after the category resource and its reset effect settle.
                this.revealTimer = setTimeout(() => {
                    if (
                        this.pendingReveal() !== request ||
                        this.options.loading()
                    )
                        return;
                    if (
                        this.id(this.activeItem()) !== request.id ||
                        this.owner() !== request.owner ||
                        this.options.store.selectedCategoryId() !==
                            request.category ||
                        this.options.store.searchPhrase()
                    ) {
                        this.pendingReveal.set(null);
                        return;
                    }
                    if (this.options.revealRow(request.id))
                        this.pendingReveal.set(null);
                }, 0);
            });
        });
    }

    /** Capture before resolution; only the winning playback request commits it. */
    prepare(item: StalkerItvChannel, context?: SelectionContext): () => void {
        const owner = this.owner();
        const generation = this.generation;
        const previous = this.origin();
        const keep =
            context === 'preserve' ||
            (previous?.owner === owner &&
                this.id(previous.item) === this.id(item));
        const term = typeof context === 'function' ? context : undefined;
        const rows = term
            ? [...this.options.rows(term)]
            : this.withRevealedItem(this.options.rows());
        const scope = this.scope(term);
        const category = this.options.store.selectedCategoryId() ?? '*';
        const categories =
            keep && previous?.owner === owner
                ? previous.categories
                : new Map(
                      rows
                          .concat(item)
                          .map((row) => [
                              this.id(row),
                              String(
                                  row.tv_genre_id ?? row.category_id ?? category
                              ),
                          ])
                  );
        return () => {
            if (owner !== this.owner() || generation !== this.generation)
                return;
            if (!keep || !this.queue.items(owner).length) {
                this.queue.capture(owner, scope, rows, item);
                this.panelTerm.set(term);
            }
            this.revealed.set(null);
            this.pendingReveal.set(null);
            this.origin.set({
                owner,
                item,
                categories,
                scope: keep ? (previous?.scope ?? scope) : scope,
            });
        };
    }

    adjacent(direction: 'up' | 'down'): void {
        const next = getAdjacentChannelItem(
            this.channels(),
            this.activeItem()?.id,
            direction,
            (item) => item.id
        );
        if (next) this.options.play(next);
    }

    selectNumber(number?: number): void {
        if (!number) return;
        const channel = getChannelItemByNumber(this.channels(), number);
        if (channel) this.options.play(channel);
    }

    async reveal(): Promise<void> {
        const active = this.activeItem();
        const category = active && this.categoryFor(active);
        if (!active || !category) return;
        const owner = this.owner();
        const generation = ++this.revealGeneration;
        const browsedCategory = this.options.store.selectedCategoryId();
        this.pendingReveal.set(null);
        if (
            this.options.router &&
            this.options.router.parseUrl(this.options.router.url).queryParams[
                'q'
            ] != null
        ) {
            const tree = this.options.router.parseUrl(this.options.router.url);
            delete tree.queryParams['q'];
            const navigated = await this.options.router
                .navigateByUrl(tree, {
                    replaceUrl: true,
                })
                .catch(() => false);
            if (
                !navigated ||
                generation !== this.revealGeneration ||
                owner !== this.owner() ||
                this.id(active) !== this.id(this.activeItem()) ||
                browsedCategory !== this.options.store.selectedCategoryId() ||
                category !== this.categoryFor(active)
            )
                return;
        }
        this.options.store.setSearchPhrase('');
        this.options.store.setSelectedCategory(category);
        this.options.store.setPage(0);
        this.options.sidebar.expand('portal');
        this.revealed.set({ owner, category, item: active });
        this.pendingReveal.set({
            owner,
            category,
            id: this.id(active),
        });
    }

    reset(): void {
        this.generation++;
        this.revealGeneration++;
        this.revealed.set(null);
        this.queue.clear();
        this.origin.set(null);
        this.pendingReveal.set(null);
        this.panelTerm.set(undefined);
        if (this.revealTimer) clearTimeout(this.revealTimer);
    }

    /** A known playing row keeps return bounded on provider-paginated search. */
    withRevealedItem(rows: StalkerItvChannel[]): StalkerItvChannel[] {
        const revealed = this.revealed();
        if (
            !revealed ||
            revealed.owner !== this.owner() ||
            revealed.category !== this.options.store.selectedCategoryId() ||
            this.options.store.searchPhrase() ||
            this.id(revealed.item) !== this.id(this.activeItem()) ||
            !this.categoryFor(revealed.item) ||
            rows.some((row) => this.id(row) === this.id(revealed.item))
        )
            return rows;
        return [revealed.item, ...rows];
    }

    private scope(panelTerm?: Signal<string>): string {
        return JSON.stringify([
            this.options.store.selectedCategoryId(),
            panelTerm ? 'panel' : 'sidebar',
            this.options.store.selectedContentType() === 'radio'
                ? this.options.store.searchPhrase()
                : '',
            panelTerm?.() ?? this.options.store.searchPhrase(),
        ]);
    }

    activeItem(): StalkerItvChannel | undefined {
        const origin = this.origin();
        return origin?.owner === this.owner()
            ? origin.item
            : (this.options.store.selectedItem() as
                  StalkerItvChannel | undefined);
    }

    private categoryFor(item: StalkerItvChannel): string | undefined {
        const origin = this.origin();
        const category = String(
            item.tv_genre_id ??
                item.category_id ??
                (origin?.owner === this.owner()
                    ? origin.categories.get(this.id(item))
                    : '') ??
                ''
        );
        return this.options.store
            .getCategoryResource?.()
            .some((entry) => String(entry.category_id) === category)
            ? category
            : undefined;
    }

    private id(item: StalkerItvChannel | null | undefined): string {
        return normalizeStalkerEntityId(item?.id);
    }
}
