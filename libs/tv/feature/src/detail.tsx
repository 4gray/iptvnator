import { Empty, TvSelect, TvDescription } from '@iptvnator/tv/ui';
import { TvModel } from './use-tv';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import { EpisodeRail } from './episode-rail';
import { MoreActions, WatchOptions, WatchStatus } from './watch-actions';
import {
    mediaTitle,
    watchLabel,
    watchState,
    resumeLabel,
    seriesAction,
    episodeCode,
} from '@iptvnator/tv/util';
import { MetadataCredits } from './metadata-credits';
import { MetadataChips } from './metadata-chips';
import { useEpisodeMetadata } from './use-episode-metadata';
export function Detail({
    tv,
    metadataClient,
    metadataLoading,
    season,
    selectSeason,
}: {
    tv: TvModel;
    metadataClient: TvMetadata;
    metadataLoading: boolean;
    season?: number;
    selectSeason: (season: number) => void;
}) {
    const item = tv.selected ?? tv.route.item;
    const seasons = Array.from(
        new Set(tv.episodes.map((e) => e.season ?? 1))
    ).sort((a, b) => a - b);
    const currentSeason =
        season && seasons.includes(season) ? season : seasons[0];
    const metadata = useEpisodeMetadata(
        item,
        tv.episodes,
        currentSeason,
        metadataClient
    );
    const entryFocus = useRef(true);
    const primary =
        item?.kind === 'series'
            ? seriesAction(item, tv.episodes, tv.data)
            : undefined;
    useLayoutEffect(() => {
        if (!entryFocus.current || !primary || tv.fullscreen) return;
        entryFocus.current = false;
        if (tv.restoreKey.startsWith('person:')) return;
        let owns = true;
        restoreFocus('detail-play', '', undefined, () => owns);
        return () => {
            owns = false;
        };
    }, [!!primary, tv.fullscreen]);
    useEffect(() => {
        if (!tv.busy && !metadataLoading && tv.restoreKey.startsWith('person:'))
            tv.finishFocus();
    }, [tv.busy, metadataLoading, tv.restoreKey, item?.metadata]);
    if (!item || item.sourceId !== tv.data.activeId) return null;
    const episodes = metadata.items.filter(
        (e) => (e.season ?? 1) === currentSeason
    );
    const action = primary;
    const saved = tv.data.favorites.some((m) => m.id === item.id);
    const position = tv.data.positions[item.id];
    // Rare actions live in ⋯: the title itself, or a series' next episode.
    const options = item.kind === 'series' ? action?.item : item;
    return (
        <>
            <section class="detail-hero">
                <div class="detail-poster">
                    {item.poster ? (
                        <img src={item.poster} alt="" />
                    ) : (
                        <span>{item.title}</span>
                    )}
                </div>
                <div>
                    <span class="eyebrow">{item.kind.toUpperCase()}</span>
                    <h1>{mediaTitle(item)}</h1>
                    {item.kind === 'episode' ? (
                        <div class="muted">
                            S{item.season ?? 1} · E{item.episode ?? 1} ·{' '}
                            {item.title}
                        </div>
                    ) : null}
                    <MetadataChips item={item} />
                    <TvDescription
                        key={item.id}
                        text={
                            item.description ||
                            'Your provider has not supplied a description for this title.'
                        }
                    />
                    {item.kind !== 'series' ? (
                        <WatchStatus progress={position} />
                    ) : null}
                    <div class="actions">
                        {item.kind === 'series' && action ? (
                            <button
                                class="primary"
                                data-focus="detail-play"
                                onClick={() =>
                                    action.kind === 'caught-up'
                                        ? tv.startOver(action.item)
                                        : tv.play(action.item)
                                }
                            >
                                {action.kind === 'caught-up'
                                    ? 'Caught up · Watch again'
                                    : action.kind === 'start'
                                      ? 'Start'
                                      : action.kind === 'resume'
                                        ? watchLabel(action.progress)
                                        : 'Continue'}{' '}
                                · {episodeCode(action.item)} ▶
                            </button>
                        ) : null}
                        {item.kind !== 'series' ? (
                            <button
                                class="primary"
                                data-focus="detail-play"
                                onClick={() => tv.play(item)}
                            >
                                {resumeLabel(position)} ▶
                            </button>
                        ) : null}
                        {item.kind !== 'series' &&
                        watchState(position) === 'in-progress' ? (
                            <button
                                data-focus="detail-start-over"
                                onClick={() => tv.startOver(item)}
                            >
                                ↺ Start over
                            </button>
                        ) : null}
                        <button
                            class="tv-toggle"
                            data-focus="favorite"
                            aria-pressed={saved}
                            onClick={() => tv.favorite(item)}
                        >
                            {saved ? '♥ Saved' : '♡ Add to favorites'}
                        </button>
                        {options ? (
                            <MoreActions
                                title={
                                    options === item
                                        ? mediaTitle(item)
                                        : `${episodeCode(options)} · ${options.title}`
                                }
                                focusKey="detail-more"
                            >
                                {(close) => (
                                    <WatchOptions
                                        tv={tv}
                                        item={options}
                                        close={close}
                                        returnFocus="detail-more"
                                        startOver={options !== item}
                                    />
                                )}
                            </MoreActions>
                        ) : null}
                    </div>
                </div>
            </section>
            {item.kind === 'series' ? (
                <section class="detail-episodes">
                    <div class="section-title">
                        <h2>Episodes</h2>
                        <label>
                            Season
                            <TvSelect
                                label="Season"
                                value={String(currentSeason)}
                                options={seasons.map((s) => ({
                                    value: String(s),
                                    label: `Season ${s}`,
                                }))}
                                onChange={(value) =>
                                    selectSeason(Number(value))
                                }
                            />
                        </label>
                    </div>
                    {metadata.failed ? (
                        <p role="status" class="metadata-notice">
                            Episode metadata is unavailable. Showing provider
                            episodes.{' '}
                            <button onClick={metadata.retry}>
                                Retry episode metadata
                            </button>
                        </p>
                    ) : null}
                    {episodes.length ? (
                        <EpisodeRail
                            key={`${item.id}:${currentSeason}`}
                            tv={tv}
                            episodes={episodes}
                            initial={
                                episodes.some((e) => e.id === tv.restoreKey)
                                    ? tv.restoreKey
                                    : action?.item.id
                            }
                        />
                    ) : null}
                    {!tv.busy && !episodes.length ? (
                        <Empty>
                            No episodes were supplied for this series.
                        </Empty>
                    ) : null}
                </section>
            ) : null}
            <MetadataCredits item={item} open={tv.openPerson} />
        </>
    );
}
