import {
    progressLabel,
    watchPercent,
    watchState,
    type Media,
} from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';

/** One focus stop per episode: OK plays; options live under the rail. */
export function EpisodeCard({
    tv,
    item: e,
    index,
    onFocus,
}: {
    tv: TvModel;
    item: Media;
    index: number;
    onFocus: () => void;
}) {
    const progress = tv.data.positions[e.id];
    const state = watchState(progress);
    return (
        <button
            data-focus={e.id}
            data-episode-index={index}
            class={`episode ${e.episodeStill ? 'with-still' : ''} ${state}`}
            aria-label={`Episode ${e.episode ?? 1}: ${e.title}${
                !progress || state === 'unwatched'
                    ? ''
                    : ` · ${progressLabel(progress)}`
            }`}
            onFocus={onFocus}
            onClick={() => tv.play(e)}
        >
            <span class="episode-frame">
                {e.episodeStill ? (
                    <img
                        key={e.episodeStill}
                        class="episode-still"
                        src={e.episodeStill}
                        alt=""
                        onError={(event) => {
                            event.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <span class="episode-number" aria-hidden="true">
                        {String(e.episode ?? 1).padStart(2, '0')}
                    </span>
                )}
                {state === 'watched' ? (
                    <span class="episode-check" aria-hidden="true">
                        ✓
                    </span>
                ) : null}
                {state === 'in-progress' &&
                progress &&
                Number.isFinite(progress.duration) &&
                progress.duration > 0 ? (
                    <progress
                        class="episode-progress"
                        aria-hidden="true"
                        max={100}
                        value={watchPercent(progress)}
                    />
                ) : null}
            </span>
            <span class="episode-title">
                <span class="episode-index">{e.episode ?? 1} · </span>
                <strong>{e.title}</strong>
            </span>
            <span class="episode-meta">
                {!progress || state === 'unwatched'
                    ? '\u00a0'
                    : progressLabel(progress)}
            </span>
        </button>
    );
}
