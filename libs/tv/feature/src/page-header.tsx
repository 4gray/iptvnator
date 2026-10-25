import { TvModel } from './use-tv';
import { favoritesFor } from './favorites';
export function PageHeader({ tv }: { tv: TvModel }) {
    const view = tv.route.view;
    const title = {
        movies: 'Movies',
        series: 'Series',
        favorites: 'Favorites',
        search: 'Find your next story.',
        live: 'Live television',
        sources: 'Sources',
        settings: 'Settings',
        home: '',
        detail: '',
        person: '',
    }[view];
    const count =
        view === 'favorites'
            ? favoritesFor(tv, tv.route.kind).length
            : ['movies', 'series', 'search', 'live'].includes(view)
              ? tv.catalog.total
              : undefined;
    return (
        <header class="page-header">
            {view === 'detail' || view === 'person' ? (
                <button
                    data-focus={
                        view === 'person' ? 'person-back' : 'detail-back'
                    }
                    onClick={tv.back}
                >
                    ← Back
                </button>
            ) : (
                <div class="page-heading">
                    {title ? <h1>{title}</h1> : null}
                    {count !== undefined ? (
                        <span class="catalog-count">
                            {count}{' '}
                            {tv.route.kind === 'live' ? 'channel' : 'title'}
                            {count === 1 ? '' : 's'}
                        </span>
                    ) : null}
                </div>
            )}
            <select
                aria-label="Active source"
                value={tv.data.activeId}
                onChange={(event) => {
                    void tv.switchSource(event.currentTarget.value);
                }}
            >
                {!tv.data.sources.length ? (
                    <option value="">No source connected</option>
                ) : null}
                {tv.data.sources.map((s) => (
                    <option value={s.id}>
                        {s.name} · {s.provider.toUpperCase()}
                    </option>
                ))}
            </select>
        </header>
    );
}
