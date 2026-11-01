import { TvSelect } from '@iptvnator/tv/ui';
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
            {view === 'home' ? (
                <span class="home-scope">All sources</span>
            ) : (
                <TvSelect
                    label="Active source"
                    focusKey="source-picker"
                    value={tv.data.activeId}
                    placeholder="No source connected"
                    options={tv.data.sources.map((s) => ({
                        value: s.id,
                        label: `${s.name} · ${s.provider.toUpperCase()}`,
                    }))}
                    onChange={(value) => {
                        void tv.switchSource(value);
                    }}
                />
            )}
        </header>
    );
}
