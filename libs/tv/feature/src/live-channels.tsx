import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
    ChannelLogo,
    Empty,
    focusKey,
    restoreFocus,
    VirtualCollection,
} from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';

const categoryKey = (id: string) => `live-category:${id}`;
export function useLiveBrowse(tv: TvModel) {
    const [categoriesOpen, setCategoriesOpen] = useState(true);
    const categories = useRef(tv.catalog.categories);
    if (tv.catalog.categories.length)
        categories.current = tv.catalog.categories;
    const categoryScroll = useRef(0);
    const returning = useRef(false);
    const channel = useRef({ key: '', scroll: 0 });
    const pending = useRef<string | null>(null);
    const [channelScroll, setChannelScroll] = useState(0);
    function choose(id: string) {
        categoryScroll.current =
            document.querySelector('.channels')?.scrollTop ?? 0;
        const same = id === tv.route.category;
        pending.current = same ? channel.current.key : '';
        setChannelScroll(same ? channel.current.scroll : 0);
        setCategoriesOpen(false);
        tv.setRoute({ ...tv.route, category: id, page: 0 });
    }
    function back() {
        returning.current = true;
        channel.current = {
            key: tv.catalog.items.some((item) => item.id === focusKey())
                ? focusKey()
                : (tv.selected?.id ?? ''),
            scroll: document.querySelector('.channels')?.scrollTop ?? 0,
        };
        setCategoriesOpen(true);
    }
    useEffect(() => {
        if (categoriesOpen) return;
        if (pending.current === null) return;
        if (!tv.catalog.items.length && !tv.catalogError) return;
        // Keep focus where the viewer moved while the catalog was loading.
        if (
            focusKey() === 'live-categories' ||
            document.activeElement === document.body
        )
            restoreFocus(
                pending.current || tv.catalog.items[0]?.id || '',
                'live-categories'
            );
        pending.current = null;
    }, [categoriesOpen, tv.catalog.items, tv.catalogError]);
    useLayoutEffect(() => {
        if (!categoriesOpen) restoreFocus('live-categories');
        if (categoriesOpen && returning.current) {
            returning.current = false;
            restoreFocus(categoryKey(tv.route.category), categoryKey(''));
        }
    }, [categoriesOpen]);
    return {
        categoriesOpen,
        categories: [
            { id: '', name: 'All channels' },
            ...categories.current,
        ].map((c) => ({
            ...c,
            categoryId: c.id,
            id: categoryKey(c.id),
        })),
        categoryName:
            categories.current.find((c) => c.id === tv.route.category)?.name ??
            'All channels',
        categoryScroll: categoryScroll.current,
        channelScroll,
        channelKey: pending.current || channel.current.key,
        choose,
        back,
    };
}
export function LiveChannels({
    tv,
    browse,
}: {
    tv: TvModel;
    browse: ReturnType<typeof useLiveBrowse>;
}) {
    return (
        <section
            class="channel-pane"
            aria-label={
                browse.categoriesOpen ? 'Channel categories' : 'Channels'
            }
        >
            <div class="channel-pane-header">
                {browse.categoriesOpen ? (
                    <h2>Categories</h2>
                ) : (
                    <button
                        data-focus="live-categories"
                        onClick={browse.back}
                        aria-label="Back to categories"
                    >
                        <span aria-hidden="true">← </span>
                        {browse.categoryName}
                    </button>
                )}
                <span class="muted">
                    {browse.categoriesOpen
                        ? 'Choose a category'
                        : 'OK: preview · OK again: fullscreen'}
                </span>
            </div>
            <div
                class="channels"
                key={browse.categoriesOpen ? 'categories' : tv.catalogKey}
            >
                {browse.categoriesOpen ? (
                    <VirtualCollection
                        layout="channels"
                        items={browse.categories}
                        restoreKey={categoryKey(tv.route.category)}
                        restoreScroll={browse.categoryScroll}
                        render={(category) => (
                            <button
                                class="live-category"
                                data-focus={category.id}
                                aria-pressed={
                                    category.categoryId === tv.route.category
                                }
                                onClick={() =>
                                    browse.choose(category.categoryId)
                                }
                            >
                                <strong>{category.name}</strong>
                                <span aria-hidden="true">→</span>
                            </button>
                        )}
                    />
                ) : (
                    <VirtualCollection
                        layout="channels"
                        items={tv.catalog.items}
                        more={tv.hasMore}
                        busy={tv.catalogBusy}
                        error={tv.catalogError}
                        loadMore={tv.loadMore}
                        restoreKey={browse.channelKey}
                        restoreScroll={browse.channelScroll}
                        render={(item, n) => (
                            <button
                                class={`channel ${tv.playing?.id === item.id && tv.player.current?.hasConfirmedPlayback ? 'is-playing' : ''}`}
                                data-focus={item.id}
                                aria-pressed={tv.selected?.id === item.id}
                                onFocus={() => tv.setSelected(item)}
                                onClick={() => {
                                    tv.setSelected(item);
                                    void tv.play(item);
                                }}
                            >
                                <span class="channel-number">
                                    {String(n + 1).padStart(2, '0')}
                                </span>
                                <ChannelLogo src={item.poster} />
                                <span>
                                    <strong>{item.title}</strong>
                                    <small>
                                        {tv.playing?.id === item.id
                                            ? tv.player.current
                                                  ?.hasConfirmedPlayback
                                                ? '● Playing'
                                                : 'Starting / paused'
                                            : 'Live channel'}
                                    </small>
                                </span>
                            </button>
                        )}
                    />
                )}
                {!browse.categoriesOpen &&
                !tv.busy &&
                !tv.catalogError &&
                !tv.catalog.items.length ? (
                    <Empty>No channels in this category.</Empty>
                ) : null}
                {browse.categoriesOpen && tv.catalogError ? (
                    <div role="alert" class="load-more-status">
                        {tv.catalogError}{' '}
                        <button onClick={tv.loadMore}>Retry loading</button>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
