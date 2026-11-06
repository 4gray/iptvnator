import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { restoreFocus, VirtualCollection } from '@iptvnator/tv/ui';
import { useCatalog } from './use-catalog';
import { GridSchedule } from './grid-schedule';
import type { TvModel } from './use-tv';
export function GridGuide({ tv, close }: { tv: TvModel; close: () => void }) {
    const [category, setCategory] = useState(
        tv.fullscreen ? tv.playingCategory : tv.route.category
    );
    const [categoriesOpen, setCategoriesOpen] = useState(false);
    const client = useRef(tv.guideClient);
    client.current = tv.guideClient;
    const catalog = useCatalog(
        { view: 'live', kind: 'live', category, page: 0, query: '' },
        client,
        tv.ready,
        tv.data.activeId,
        () => undefined,
        'provider'
    );
    const categories = useRef(tv.catalog.categories);
    if (catalog.catalog.categories.length)
        categories.current = catalog.catalog.categories;
    const choices = [
        { id: '', name: 'All channels' },
        ...categories.current.filter((c) => c.id),
    ];
    const categoryName =
        choices.find((c) => c.id === category)?.name ?? 'Channels';
    const root = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const back = (event: Event) => {
            if (!categoriesOpen) return;
            event.preventDefault();
            setCategoriesOpen(false);
            restoreFocus('grid-category');
        };
        const node = root.current;
        if (!node) return;
        node.addEventListener('tv-overlay-back', back);
        return () => node.removeEventListener('tv-overlay-back', back);
    }, [categoriesOpen]);
    return (
        <div class="grid-guide" ref={root}>
            <header class="grid-guide-header">
                <div>
                    <span class="muted">LIVE TELEVISION</span>
                    <h1>TV Guide</h1>
                </div>
                <button
                    data-focus="grid-category"
                    onClick={() => {
                        setCategoriesOpen(!categoriesOpen);
                        restoreFocus(
                            `grid-category:${category}`,
                            'grid-category-back'
                        );
                    }}
                >
                    {categoryName} ↓
                </button>
                <button data-focus="grid-close" onClick={close}>
                    Close guide ×
                </button>
            </header>
            {categoriesOpen ? (
                <section class="grid-categories">
                    <button
                        data-focus="grid-category-back"
                        onClick={() => {
                            setCategoriesOpen(false);
                            restoreFocus('grid-category');
                        }}
                    >
                        ← Back to guide
                    </button>
                    <div class="channels">
                        <VirtualCollection
                            layout="channels"
                            items={choices.map((c) => ({
                                ...c,
                                categoryId: c.id,
                                id: `grid-category:${c.id}`,
                            }))}
                            restoreKey={`grid-category:${category}`}
                            render={(c) => (
                                <button
                                    class="live-category"
                                    data-focus={c.id}
                                    aria-pressed={c.categoryId === category}
                                    onClick={() => {
                                        setCategory(c.categoryId);
                                        setCategoriesOpen(false);
                                        restoreFocus('grid-now');
                                    }}
                                >
                                    {c.name}
                                </button>
                            )}
                        />
                    </div>
                </section>
            ) : (
                <GridSchedule
                    key={category}
                    tv={tv}
                    category={category}
                    catalog={catalog}
                    close={close}
                />
            )}
        </div>
    );
}
