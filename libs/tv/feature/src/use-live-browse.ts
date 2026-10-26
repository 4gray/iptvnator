import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { focusKey, restoreFocus } from '@iptvnator/tv/ui';
import type { TvModel } from './use-tv';
function visibleChannels() {
    return (
        document.querySelector('[data-tv-modal] .channels') ??
        document.querySelector('main .channels')
    );
}
export const categoryKey = (id: string) => `live-category:${id}`;
export function useLiveBrowse(tv: TvModel) {
    const [categoriesOpen, setCategoriesOpen] = useState(true);
    const source = useRef(tv.data.activeId);
    const categories = useRef(tv.catalog.categories);
    if (
        source.current === tv.data.activeId &&
        tv.route.view === 'live' &&
        tv.catalog.categories.length
    )
        categories.current = tv.catalog.categories;
    const categoryScroll = useRef(0);
    const returning = useRef(false);
    const channel = useRef({ key: '', scroll: 0 });
    const pending = useRef<string | null>(null);
    const [channelScroll, setChannelScroll] = useState<number | undefined>(0);
    function remember() {
        channel.current = {
            key: focusKey(),
            scroll: visibleChannels()?.scrollTop ?? 0,
        };
        setChannelScroll(channel.current.scroll);
    }
    function showPlaying() {
        pending.current = tv.playing?.id ?? '';
        channel.current = { key: pending.current, scroll: 0 };
        setChannelScroll(undefined);
        setCategoriesOpen(false);
        tv.setRoute({
            ...tv.route,
            category: tv.playingCategory,
            query: '',
            page: 0,
        });
    }
    useLayoutEffect(() => {
        const changed = source.current !== tv.data.activeId;
        source.current = tv.data.activeId;
        if (changed || tv.route.view !== 'live') {
            setCategoriesOpen(true);
            categories.current = [];
            categoryScroll.current = 0;
            channel.current = { key: '', scroll: 0 };
            setChannelScroll(0);
            pending.current = null;
            returning.current = false;
            if (changed && tv.route.view === 'live') {
                tv.setRoute({ ...tv.route, category: '', query: '', page: 0 });
                restoreFocus(categoryKey(''));
            }
        }
    }, [tv.data.activeId, tv.route.view]);
    function choose(id: string) {
        categoryScroll.current = visibleChannels()?.scrollTop ?? 0;
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
            scroll: visibleChannels()?.scrollTop ?? 0,
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
            focusKey() === 'channels-close' ||
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
        remember,
        showPlaying,
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
