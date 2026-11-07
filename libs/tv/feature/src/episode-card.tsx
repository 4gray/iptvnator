import { TvSelect } from '@iptvnator/tv/ui';
import {
    episodeCode,
    watchLabel,
    watchState,
    type Media,
    type WatchAction,
} from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';
import { WatchStatus } from './watch-actions';
import { navigationOrigin } from './use-route-history';

export function EpisodeCard({
    tv,
    item: e,
    ...virtual
}: {
    tv: TvModel;
    item: Media;
    'data-virtual-index'?: number;
}) {
    const watched = watchState(tv.data.positions[e.id]) === 'watched';
    return (
        <div
            class="episode-entry"
            data-episode-index={virtual['data-virtual-index']}
            onKeyDown={(event) => {
                const target = event.target as HTMLElement;
                const down = event.key === 'ArrowDown' || event.keyCode === 40;
                const up = event.key === 'ArrowUp' || event.keyCode === 38;
                const action = target.closest('.tv-select');
                if ((down && target.matches('.episode')) || (up && action)) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget
                        .querySelector<HTMLButtonElement>(
                            action ? '.episode' : '.tv-select'
                        )
                        ?.focus();
                }
            }}
        >
            <button
                {...virtual}
                data-focus={e.id}
                class={`episode ${e.episodeStill ? 'with-still' : ''}`}
                onClick={() => tv.play(e)}
            >
                {e.episodeStill ? (
                    <img
                        key={e.episodeStill}
                        class="episode-still"
                        src={e.episodeStill}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                            event.currentTarget.style.display = 'none';
                        }}
                    />
                ) : null}
                <span class="episode-copy">
                    <span class="episode-number">
                        {String(e.episode ?? 1).padStart(2, '0')}
                    </span>
                    <strong>{e.title}</strong>
                    {e.description ? (
                        <span class="episode-description">{e.description}</span>
                    ) : null}
                    <WatchStatus progress={tv.data.positions[e.id]} />
                    <small>
                        {watchLabel(tv.data.positions[e.id])} episode →
                    </small>
                </span>
            </button>
            <TvSelect
                label={`Watch actions · ${episodeCode(e)} · ${e.title}`}
                value=""
                placeholder="Watch actions"
                options={[
                    {
                        value: watched ? 'unwatched' : 'watched',
                        label: watched ? 'Mark unwatched' : 'Mark watched',
                    },
                    { value: 'reset', label: 'Reset progress' },
                    { value: 'start-over', label: 'Start over' },
                ]}
                onChange={(value) =>
                    value === 'start-over'
                        ? void tv.startOver(e, navigationOrigin(e.id))
                        : void tv.watch(e, value as WatchAction)
                }
            />
        </div>
    );
}
