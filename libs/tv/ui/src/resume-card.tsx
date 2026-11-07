import { Progress, mediaTitle, progressLabel } from '@iptvnator/tv/util';
import { TvIcon } from './icon';

export function ResumeCard({
    progress,
    poster,
    open,
    sourceName,
    date,
    focusKey,
    next = false,
}: {
    progress: Progress;
    poster?: string;
    sourceName?: string;
    open: () => void;
    date?: number;
    focusKey?: string;
    next?: boolean;
}) {
    const { item, seconds, duration } = progress;
    const knownDuration = Number.isFinite(duration) && duration > 0;
    return (
        <article class="resume-entry" aria-label={mediaTitle(item)}>
            <button
                class="resume-card"
                data-focus={focusKey ?? item.id}
                aria-haspopup="dialog"
                onClick={open}
            >
                <span class="poster-art">
                    <span class="resume-fallback" aria-hidden="true">
                        <TvIcon
                            name={
                                item.kind === 'live'
                                    ? 'live'
                                    : item.kind === 'episode'
                                      ? 'series'
                                      : 'movies'
                            }
                        />
                    </span>
                    {poster ? (
                        <img
                            key={poster}
                            src={poster}
                            alt=""
                            loading="lazy"
                            onError={(event) => {
                                event.currentTarget.style.display = 'none';
                            }}
                        />
                    ) : null}
                    <span class="resume-options" aria-hidden="true">
                        <TvIcon name="more" />
                    </span>
                    {item.kind !== 'live' && knownDuration ? (
                        <progress
                            class="resume-progress"
                            aria-label={`${mediaTitle(item)}: viewing progress`}
                            max={duration}
                            value={
                                !progress.reset && Number.isFinite(seconds)
                                    ? Math.min(Math.max(seconds, 0), duration)
                                    : 0
                            }
                        />
                    ) : null}
                </span>
                <strong>{mediaTitle(item)}</strong>
                {item.kind === 'episode' ? (
                    <span class="muted resume-episode">
                        S{item.season ?? 1} · E{item.episode ?? 1} ·{' '}
                        {item.title}
                    </span>
                ) : null}
                {sourceName ? <span class="muted">{sourceName}</span> : null}
                <span class="resume-position">
                    {next ? 'Next episode' : progressLabel(progress)}
                </span>
                {date !== undefined ? (
                    <time
                        class="resume-date"
                        dateTime={new Date(date).toISOString()}
                    >
                        {new Date(date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                        })}
                    </time>
                ) : null}
                <span class="resume-action">Options</span>
            </button>
        </article>
    );
}
