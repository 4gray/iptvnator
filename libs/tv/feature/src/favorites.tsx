import { storedMediaPoster } from '@iptvnator/tv/data-access';
import { Empty, Poster, VirtualCollection } from '@iptvnator/tv/ui';
import { Kind } from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function favoritesFor(tv: TvModel, kind: Kind) {
    return tv.data.favorites.filter(
        (item) =>
            item.sourceId === tv.data.activeId &&
            (item.kind === kind ||
                (kind === 'series' && item.kind === 'episode'))
    );
}
const tabs = [
    ['movie', 'Movies'],
    ['series', 'Series'],
    ['live', 'TV'],
] as const;
export function Favorites({ tv }: { tv: TvModel }) {
    const kind = tv.route.kind;
    const items = favoritesFor(tv, kind);
    return (
        <>
            <div class="favorite-types" role="group" aria-label="Favorite type">
                {tabs.map(([value, label]) => (
                    <button
                        data-focus={`favorites:${value}`}
                        aria-pressed={kind === value}
                        onClick={() => {
                            tv.setRoute({ ...tv.route, kind: value, page: 0 });
                            document.querySelector('main')?.scrollTo(0, 0);
                        }}
                    >
                        {label} <span>{favoritesFor(tv, value).length}</span>
                    </button>
                ))}
            </div>
            <VirtualCollection
                key={`${tv.data.activeId}:${kind}`}
                items={items}
                layout={kind === 'live' ? 'stations' : 'posters'}
                restoreKey={tv.restoreKey}
                restoreScroll={tv.restoreScroll}
                render={(item) => (
                    <Poster
                        item={{
                            ...item,
                            poster: storedMediaPoster(
                                item,
                                tv.data.sources.find(
                                    (s) => s.id === item.sourceId
                                )
                            ),
                        }}
                        open={tv.open}
                        saved
                    />
                )}
            />
            {!items.length ? (
                <Empty>
                    {kind === 'live'
                        ? 'Save a channel to see it here.'
                        : kind === 'series'
                          ? 'Save a series or episode to see it here.'
                          : 'Save a movie to see it here.'}
                </Empty>
            ) : null}
        </>
    );
}
