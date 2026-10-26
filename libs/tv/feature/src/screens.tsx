import type { HomeFeature } from './use-home-feature';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import { CatalogOrder, CatalogSortNotice } from './catalog-order';
import {
    Empty,
    Hero,
    VirtualCollection,
    Poster,
    ResumeCard,
} from '@iptvnator/tv/ui';
import { Media } from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function Home({
    tv,
    feature,
    openSeries,
    detailsBusy,
}: {
    tv: TvModel;
    feature: HomeFeature;
    openSeries: (item: Media) => Promise<void>;
    detailsBusy: boolean;
}) {
    const items = tv.home;
    const sourceId = tv.data.activeId;
    const history = feature.history;
    const rails: [string, Media[]][] = [
        [
            'Favorite channels',
            tv.data.favorites
                .filter((m) => m.sourceId === sourceId && m.kind === 'live')
                .slice(0, 8),
        ],
        ['Films from your source', items.filter((m) => m.kind === 'movie')],
        ['Series from your source', items.filter((m) => m.kind === 'series')],
        ['On television', items.filter((m) => m.kind === 'live')],
    ];
    return (
        <>
            <Hero
                item={feature.item}
                progress={feature.progress}
                play={tv.play}
                index={feature.index}
                count={feature.count}
                select={feature.select}
                open={(item) =>
                    item.kind === 'episode'
                        ? void openSeries(item)
                        : tv.open(item)
                }
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
                                play={tv.play}
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
                .filter(([, list]) => list.length)
                .map(([title, list]) => (
                    <section>
                        <h2>{title}</h2>
                        <div class="rail">
                            {list.map((item) => (
                                <Poster
                                    key={item.id}
                                    item={item}
                                    open={tv.open}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            {!tv.busy && !items.length ? (
                <Empty>
                    {tv.data.sources.length ? (
                        'This source has no titles available here. Browse TV or check your source.'
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
                        <select
                            aria-label="Content type"
                            value={r.kind}
                            onChange={(e) =>
                                tv.setRoute({
                                    ...r,
                                    kind: e.currentTarget
                                        .value as typeof r.kind,
                                    page: 0,
                                    category: '',
                                })
                            }
                        >
                            <option value="movie">Movies</option>
                            <option value="series">Series</option>
                            <option value="live">Live TV</option>
                        </select>
                    </label>
                ) : null}
                <label>
                    Category
                    <select
                        value={r.category}
                        onChange={(e) =>
                            tv.setRoute({
                                ...r,
                                category: e.currentTarget.value,
                                page: 0,
                            })
                        }
                    >
                        <option value="">All categories</option>
                        {tv.catalog.categories.map((c) => (
                            <option value={c.id}>{c.name}</option>
                        ))}
                    </select>
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
