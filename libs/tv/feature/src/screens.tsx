import type { HomeFeature } from './use-home-feature';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import { CatalogOrder, CatalogSortNotice } from './catalog-order';
import {
    Empty,
    TvSelect,
    Hero,
    VirtualCollection,
    Poster,
    ResumeCard,
} from '@iptvnator/tv/ui';
import { mediaTitle, Media } from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function Home({
    tv,
    feature,
    actions,
    detailsBusy,
}: {
    tv: TvModel;
    feature: HomeFeature;
    actions: { open: (item: Media) => void; play: (item: Media) => void };
    detailsBusy: boolean;
}) {
    const sourceName = (item: Media) =>
        tv.data.sources.find((s) => s.id === item.sourceId)?.name ??
        'Source unavailable';
    const history = feature.history;
    const catalogSource =
        tv.data.sources.find((s) => s.id === tv.data.activeId)?.name ??
        'Selected source';
    const rails: [string, string, Media[]][] = [
        [
            'favorite-channels',
            'Favorite channels',
            tv.data.favorites.filter((m) => m.kind === 'live').slice(0, 8),
        ],
        [
            'saved-movies',
            'Saved films',
            tv.data.favorites
                .filter((m) => m.kind === 'movie')
                .slice(-12)
                .reverse(),
        ],
        [
            'saved-series',
            'Saved series',
            tv.data.favorites
                .filter((m) => m.kind === 'series' || m.kind === 'episode')
                .slice(-12)
                .reverse(),
        ],
        [
            'catalog-movies',
            `Films · ${catalogSource}`,
            tv.home.filter((m) => m.kind === 'movie'),
        ],
        [
            'catalog-series',
            `Series · ${catalogSource}`,
            tv.home.filter((m) => m.kind === 'series'),
        ],
        [
            'catalog-live',
            `On television · ${catalogSource}`,
            tv.home.filter((m) => m.kind === 'live'),
        ],
    ];
    return (
        <>
            <Hero
                item={feature.item}
                progress={feature.progress}
                play={actions.play}
                index={feature.index}
                count={feature.count}
                select={feature.select}
                open={actions.open}
                sourceName={feature.item ? sourceName(feature.item) : undefined}
                detailsBusy={detailsBusy}
                compact={tv.data.layout === 'shelf'}
            />
            {history.length ? (
                <section>
                    <h2>Continue watching</h2>
                    <div class="rail">
                        {history.map((p) => (
                            <ResumeCard
                                key={p.item.id}
                                progress={p}
                                play={actions.play}
                                sourceName={sourceName(p.item)}
                                poster={storedMediaPoster(
                                    p.item,
                                    tv.data.sources.find(
                                        (s) => s.id === p.item.sourceId
                                    ),
                                    [...tv.home, ...tv.data.favorites]
                                )}
                            />
                        ))}
                    </div>
                </section>
            ) : null}
            {rails
                .filter(([, , list]) => list.length)
                .map(([railId, title, list]) => (
                    <section>
                        <h2>{title}</h2>
                        <div class="rail">
                            {list.map((item) => (
                                <Poster
                                    key={item.id}
                                    focusKey={JSON.stringify([
                                        'home',
                                        railId,
                                        item.id,
                                    ])}
                                    item={{
                                        ...item,
                                        title: mediaTitle(item),
                                        poster: storedMediaPoster(
                                            item,
                                            tv.data.sources.find(
                                                (s) => s.id === item.sourceId
                                            ),
                                            [...tv.home, ...tv.data.favorites]
                                        ),
                                    }}
                                    open={() => actions.open(item)}
                                    sourceName={sourceName(item)}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            {!history.length &&
            !tv.data.favorites.length &&
            !tv.home.length &&
            !tv.busy ? (
                <Empty>
                    {tv.data.sources.length ? (
                        <>
                            <p>
                                Watch a title or save a favorite to see it here,
                                across all your sources.
                            </p>
                            <button
                                class="primary"
                                onClick={() => tv.navigate('movies')}
                            >
                                Browse movies
                            </button>
                        </>
                    ) : (
                        <>
                            <h2>Your screen, your sources.</h2>
                            <button
                                class="primary"
                                onClick={() => tv.navigate('sources')}
                            >
                                Add your first source
                            </button>
                        </>
                    )}
                </Empty>
            ) : null}
        </>
    );
}
export function CatalogScreen({ tv }: { tv: TvModel }) {
    const r = tv.route;
    const list = tv.catalog.items;
    return (
        <>
            <div class="catalog-filters">
                <label>
                    Search this source
                    <input
                        type="search"
                        aria-label="Search this source"
                        value={r.query}
                        onInput={(e) =>
                            tv.setRoute({
                                ...r,
                                query: e.currentTarget.value,
                                page: 0,
                            })
                        }
                    />
                </label>
                {r.view === 'search' ? (
                    <label>
                        Content
                        <TvSelect
                            label="Content type"
                            value={r.kind}
                            options={[
                                { value: 'movie', label: 'Movies' },
                                { value: 'series', label: 'Series' },
                                { value: 'live', label: 'Live TV' },
                            ]}
                            onChange={(value) =>
                                tv.setRoute({
                                    ...r,
                                    kind: value as typeof r.kind,
                                    page: 0,
                                    category: '',
                                })
                            }
                        />
                    </label>
                ) : null}
                <label>
                    Category
                    <TvSelect
                        label="Category"
                        value={r.category}
                        options={[
                            { value: '', label: 'All categories' },
                            ...tv.catalog.categories.map((c) => ({
                                value: c.id,
                                label: c.name,
                            })),
                        ]}
                        onChange={(value) =>
                            tv.setRoute({ ...r, category: value, page: 0 })
                        }
                    />
                </label>
                {r.kind === 'movie' || r.kind === 'series' ? (
                    <CatalogOrder tv={tv} kind={r.kind} />
                ) : null}
            </div>
            <CatalogSortNotice tv={tv} />
            <VirtualCollection
                key={tv.catalogKey}
                layout={r.kind === 'live' ? 'stations' : 'posters'}
                items={list}
                more={tv.hasMore}
                busy={tv.catalogBusy}
                error={tv.catalogError}
                loadMore={tv.loadMore}
                restoreKey={tv.restoreKey}
                restoreScroll={tv.restoreScroll}
                render={(item) => <Poster item={item} open={tv.open} />}
            />
            {!tv.busy && !list.length ? (
                <Empty>
                    No titles in this category. Try another category or search.
                </Empty>
            ) : null}
        </>
    );
}
