import { useState } from 'preact/hooks';
import { Empty, Hero, Pager, Poster } from '@iptvnator/tv/ui';
import { Media } from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function Home({ tv }: { tv: TvModel }) {
    const items = tv.home;
    const sourceId = tv.data.activeId;
    const history = tv.data.history
        .filter(
            (h) =>
                h.item.sourceId === sourceId &&
                h.item.kind !== 'live' &&
                h.seconds > 0 &&
                (!h.duration || h.duration - h.seconds > 15)
        )
        .slice(0, 8);
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
                item={items.find((m) => m.kind === 'movie') ?? items[0]}
                open={tv.open}
                compact={tv.data.layout === 'shelf'}
            />
            {history.length ? (
                <section>
                    <h2>Continue watching</h2>
                    <div class="rail">
                        {history.map((p) => (
                            <button
                                class="resume-card"
                                data-focus={p.item.id}
                                onClick={() => tv.play(p.item)}
                            >
                                <strong>{p.item.title}</strong>
                                <span>
                                    {p.item.season
                                        ? `S${p.item.season} · E${p.item.episode} · `
                                        : ''}
                                    {Math.floor(p.seconds / 60)} min watched
                                </span>
                                <progress
                                    max={p.duration || 1}
                                    value={p.seconds}
                                />
                            </button>
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
    const favorites = r.view === 'favorites';
    const list = favorites
        ? tv.data.favorites
              .filter((m) => m.sourceId === tv.data.activeId)
              .slice(r.page * 60, (r.page + 1) * 60)
        : tv.catalog.items;
    const total = favorites
        ? tv.data.favorites.filter((m) => m.sourceId === tv.data.activeId)
              .length
        : tv.catalog.total;
    return (
        <>
            <h1>
                {r.view === 'favorites'
                    ? 'Favorites'
                    : r.view === 'search'
                      ? 'Find your next story.'
                      : r.view === 'series'
                        ? 'Series'
                        : 'Movies'}
            </h1>
            {!favorites ? (
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
                </div>
            ) : null}
            <p class="muted">
                {total} titles ·{' '}
                {tv.data.sources.find((s) => s.id === tv.data.activeId)?.name}
            </p>
            <div class="poster-grid">
                {list.map((item) => (
                    <Poster
                        key={item.id}
                        item={item}
                        open={tv.open}
                        saved={favorites}
                    />
                ))}
            </div>
            {!tv.busy && !list.length ? (
                <Empty>
                    {favorites
                        ? 'Save a title or channel to see it here.'
                        : 'No titles in this category. Try another category or search.'}
                </Empty>
            ) : null}
            <Pager
                page={r.page}
                next={
                    favorites
                        ? (r.page + 1) * 60 < total
                        : list.length > 0 &&
                          (r.page + 1) * (tv.catalog.pageSize || 60) < total
                }
                previous={(delta) => {
                    tv.setRoute({ ...r, page: r.page + delta });
                    document.querySelector('main')?.scrollTo(0, 0);
                }}
            />
        </>
    );
}
