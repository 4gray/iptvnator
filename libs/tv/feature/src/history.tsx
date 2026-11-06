import { Empty, restoreFocus } from '@iptvnator/tv/ui';
import type { Media } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';
import { ViewingCard } from './viewing-card';
import { useLayoutEffect, useRef } from 'preact/hooks';

const PAGE_SIZE = 24;
export function History({
    tv,
    actions,
}: {
    tv: TvModel;
    actions: {
        open: (item: Media) => void;
        play: (item: Media) => void;
        leave: () => void;
    };
}) {
    const entries = [...tv.data.history].sort((a, b) => b.updated - a.updated);
    const pages = Math.ceil(entries.length / PAGE_SIZE);
    const played = useRef<string>();
    if (tv.fullscreen && tv.playing) played.current = tv.playing.id;
    const returnFocus =
        !tv.fullscreen && played.current
            ? `history:${played.current}`
            : tv.restoreKey;
    const returnIndex = entries.findIndex(
        (p) =>
            returnFocus === `history:${p.item.id}` ||
            returnFocus === `history:details:${p.item.id}`
    );
    // Playback moves a title to the newest page; restore that title there.
    const page =
        returnIndex >= 0
            ? Math.floor(returnIndex / PAGE_SIZE)
            : Math.max(0, Math.min(tv.route.page, pages - 1));
    useLayoutEffect(() => {
        if (tv.fullscreen || !returnFocus) return;
        const fromPlayback = !!played.current;
        played.current = undefined;
        if (page !== tv.route.page) tv.setRoute({ ...tv.route, page });
        if (fromPlayback) restoreFocus(returnFocus, 'nav:history', 0);
    }, [tv.fullscreen, returnFocus, page]);
    const changePage = (next: number) => {
        actions.leave();
        tv.setRoute({ ...tv.route, page: next });
        restoreFocus(
            `history:${entries[next * PAGE_SIZE].item.id}`,
            'nav:history',
            0
        );
    };
    if (!entries.length)
        return (
            <Empty>
                <p>Your viewing history is empty.</p>
                <button class="primary" onClick={() => tv.navigate('movies')}>
                    Browse movies
                </button>
            </Empty>
        );
    return (
        <>
            <p class="muted">
                Recently played across all sources, including watched titles.
            </p>
            <div class="poster-grid history-list">
                {entries
                    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                    .map((p) => (
                        <ViewingCard
                            key={p.item.id}
                            tv={tv}
                            progress={p}
                            date={p.updated}
                            focusKey={`history:${p.item.id}`}
                            actions={actions}
                        />
                    ))}
            </div>
            {pages > 1 ? (
                <div class="pager" aria-label="History pages">
                    <button
                        disabled={page === 0}
                        onClick={() => changePage(page - 1)}
                    >
                        Previous page
                    </button>
                    <span>
                        {page + 1} / {pages}
                    </span>
                    <button
                        disabled={page + 1 === pages}
                        onClick={() => changePage(page + 1)}
                    >
                        Next page
                    </button>
                </div>
            ) : null}
        </>
    );
}
