import { storedMediaPoster } from '@iptvnator/tv/data-access';
import {
    Empty,
    Poster,
    TvSelect,
    VirtualCollection,
    restoreFocus,
} from '@iptvnator/tv/ui';
import { Kind, Media } from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function favoritesFor(tv: TvModel, kind: Kind) {
    return tv.data.favorites.filter(
        (item) =>
            (tv.data.favoriteScope === 'all' ||
                item.sourceId === tv.data.activeId) &&
            (item.kind === kind ||
                (kind === 'series' && item.kind === 'episode'))
    );
}
const tabs = [
    ['movie', 'Movies'],
    ['series', 'Series'],
    ['live', 'TV'],
] as const;
async function saveScope(
    tv: TvModel,
    value: 'all' | 'current',
    cancel: () => void
) {
    cancel();
    const picker = document.querySelector<HTMLElement>(
        '[data-focus="favorite-sources"]'
    );
    try {
        await tv.update((data) => ({ ...data, favoriteScope: value }));
        tv.clearError('Retry favorite filter');
        document.querySelector('main')?.scrollTo(0, 0);
        restoreFocus(
            'favorite-sources',
            '',
            undefined,
            () =>
                !!picker?.isConnected &&
                document.activeElement === document.body &&
                !document.querySelector('[data-tv-modal]')
        );
    } catch {
        tv.setError(
            'Favorite filter was not saved. Free TV storage and retry.',
            () => void saveScope(tv, value, cancel),
            'Retry favorite filter'
        );
    }
}
export function FavoriteSources({
    tv,
    cancel,
}: {
    tv: TvModel;
    cancel: () => void;
}) {
    const source = tv.data.sources.find((s) => s.id === tv.data.activeId);
    return (
        <TvSelect
            label="Favorite sources"
            focusKey="favorite-sources"
            value={tv.data.favoriteScope}
            options={[
                { value: 'all', label: 'All playlists' },
                {
                    value: 'current',
                    label: `Current · ${source?.name ?? 'No playlist selected'}`,
                },
            ]}
            onChange={(value) =>
                void saveScope(tv, value as 'all' | 'current', cancel)
            }
        />
    );
}
export function Favorites({
    tv,
    actions,
}: {
    tv: TvModel;
    actions: { open: (item: Media) => void; leave: () => void };
}) {
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
                            actions.leave();
                            tv.setRoute({ ...tv.route, kind: value, page: 0 });
                            document.querySelector('main')?.scrollTo(0, 0);
                        }}
                    >
                        {label} <span>{favoritesFor(tv, value).length}</span>
                    </button>
                ))}
            </div>
            <VirtualCollection
                key={`${tv.data.favoriteScope === 'current' ? tv.data.activeId : 'all'}:${kind}`}
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
                        open={actions.open}
                        sourceName={
                            tv.data.sources.find(
                                (source) => source.id === item.sourceId
                            )?.name ?? 'Source unavailable'
                        }
                        saved
                    />
                )}
            />
            {!items.length ? (
                <Empty>
                    {tv.data.favoriteScope === 'current' ? (
                        <>
                            <p>No favorites in this playlist.</p>
                            <button
                                onClick={() =>
                                    void saveScope(tv, 'all', actions.leave)
                                }
                            >
                                Show all playlists
                            </button>
                        </>
                    ) : kind === 'live' ? (
                        'Save a channel to see it here.'
                    ) : kind === 'series' ? (
                        'Save a series or episode to see it here.'
                    ) : (
                        'Save a movie to see it here.'
                    )}
                </Empty>
            ) : null}
        </>
    );
}
