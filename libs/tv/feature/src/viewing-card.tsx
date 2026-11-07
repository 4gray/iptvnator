import { useRef, useState } from 'preact/hooks';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import { ResumeCard, TvDialog, restoreFocus } from '@iptvnator/tv/ui';
import {
    mediaTitle,
    watchLabel,
    watchState,
    type Media,
    type Progress,
} from '@iptvnator/tv/util';
import { navigationOrigin, type NavigationOrigin } from './use-route-history';
import type { TvModel } from './use-tv';
import { WatchedButton } from './watched-button';

/** One cover owns the focus origin for all of its menu actions. */
export function ViewingCard({
    tv,
    progress,
    actions,
    date,
    focusKey = progress.item.id,
}: {
    tv: TvModel;
    progress: Progress;
    actions: {
        play: (item: Media, origin?: NavigationOrigin) => void;
        open: (item: Media, origin?: NavigationOrigin) => void;
        leave: () => void;
    };
    date?: number;
    focusKey?: string;
}) {
    const [menu, setMenu] = useState(false);
    const origin = useRef<NavigationOrigin>({ focus: focusKey, scroll: 0 });
    const { item } = progress;
    const source = tv.data.sources.find((s) => s.id === item.sourceId);
    const close = () => setMenu(false);
    const next =
        date === undefined &&
        item.kind === 'episode' &&
        watchState(progress) === 'unwatched';
    const playLabel =
        item.kind === 'live'
            ? 'Watch live'
            : next
              ? 'Next episode'
              : watchLabel(progress);
    return (
        <>
            <ResumeCard
                progress={progress}
                date={date}
                next={next}
                focusKey={focusKey}
                sourceName={source?.name ?? 'Source unavailable'}
                poster={storedMediaPoster(item, source, [
                    ...tv.home,
                    ...tv.data.favorites,
                ])}
                open={() => {
                    actions.leave();
                    origin.current = navigationOrigin(focusKey);
                    setMenu(true);
                }}
            />
            {menu ? (
                <TvDialog
                    title={mediaTitle(item)}
                    close={close}
                    className="tv-card-menu"
                >
                    <div
                        class="tv-card-options"
                        role="group"
                        aria-label="Title actions"
                    >
                        <button
                            class="primary"
                            data-dialog-initial
                            onClick={() => {
                                close();
                                actions.play(item, origin.current);
                            }}
                        >
                            {playLabel}
                        </button>
                        {item.kind !== 'live' ? (
                            <button
                                onClick={() => {
                                    close();
                                    actions.open(item, origin.current);
                                }}
                            >
                                Details
                            </button>
                        ) : null}
                        {item.kind === 'movie' || item.kind === 'episode' ? (
                            <WatchedButton
                                tv={tv}
                                progress={progress}
                                returnFocus={focusKey}
                                beforeChange={() => {
                                    close();
                                    actions.leave();
                                }}
                                removed={() =>
                                    restoreFocus(
                                        focusKey,
                                        'hero-resume',
                                        origin.current.scroll
                                    )
                                }
                            />
                        ) : null}
                    </div>
                </TvDialog>
            ) : null}
        </>
    );
}
