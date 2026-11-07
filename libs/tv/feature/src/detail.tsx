import {
    Empty,
    VirtualCollection,
    TvSelect,
    TvDescription,
} from '@iptvnator/tv/ui';
import { TvModel } from './use-tv';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { restoreFocus } from '@iptvnator/tv/ui';
import { EpisodeCard } from './episode-card';
import { WatchActions, WatchStatus } from './watch-actions';
import {
    mediaTitle,
    watchLabel,
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
                        <WatchStatus progress={tv.data.positions[item.id]} />
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
                                {watchLabel(tv.data.positions[item.id])} ▶
                            </button>
                        ) : null}
                        <button
                            data-focus="favorite"
                            aria-pressed={saved}
                            onClick={() => tv.favorite(item)}
                        >
                            {saved ? '♥ Saved' : '♡ Add to favorites'}
                        </button>
                        {item.kind !== 'series' ? (
                            <WatchActions tv={tv} item={item} />
                        ) : null}
                    </div>
                </div>
            </section>
            <MetadataCredits item={item} open={tv.openPerson} />
            {item.kind === 'series' ? (
                <section
                    class={
                        episodes.some((e) => e.episodeStill)
                            ? 'rich-episodes'
                            : ''
                    }
                >
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
                    <VirtualCollection
                        key={`${item.id}:${currentSeason}`}
                        layout="episodes"
                        items={episodes}
                        render={(e) => <EpisodeCard tv={tv} item={e} />}
                    />
                    {!tv.busy && !episodes.length ? (
                        <Empty>
                            No episodes were supplied for this series.
                        </Empty>
                    ) : null}
                </section>
            ) : null}
        </>
    );
}
