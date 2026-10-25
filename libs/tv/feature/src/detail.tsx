import { useState } from 'preact/hooks';
import { Empty, VirtualCollection } from '@iptvnator/tv/ui';
import { TvModel } from './use-tv';
export function Detail({ tv }: { tv: TvModel }) {
    const [season, setSeason] = useState<number>();
    const item = tv.selected ?? tv.route.item;
    if (!item) return null;
    const seasons = Array.from(
        new Set(tv.episodes.map((e) => e.season ?? 1))
    ).sort((a, b) => a - b);
    const currentSeason =
        season && seasons.includes(season) ? season : seasons[0];
    const episodes = tv.episodes.filter(
        (e) => (e.season ?? 1) === currentSeason
    );
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
                    <span class="eyebrow">
                        {item.kind.toUpperCase()}{' '}
                        {item.year ? `· ${item.year}` : ''}
                    </span>
                    <h1>{item.title}</h1>
                    <p>
                        {item.description ||
                            'Your provider has not supplied a description for this title.'}
                    </p>
                    <div class="actions">
                        {item.kind !== 'series' ? (
                            <button
                                class="primary"
                                data-focus="detail-play"
                                onClick={() => tv.play(item)}
                            >
                                {tv.data.positions[item.id]?.seconds
                                    ? 'Resume'
                                    : 'Watch now'}{' '}
                                ▶
                            </button>
                        ) : null}
                        <button
                            data-focus={
                                item.kind === 'series'
                                    ? 'detail-play'
                                    : 'favorite'
                            }
                            aria-pressed={saved}
                            onClick={() => tv.favorite(item)}
                        >
                            {saved ? '♥ Saved' : '♡ Add to favorites'}
                        </button>
                    </div>
                </div>
            </section>
            {item.kind === 'series' ? (
                <section>
                    <div class="section-title">
                        <h2>Episodes</h2>
                        <label>
                            Season
                            <select
                                aria-label="Season"
                                value={currentSeason}
                                onChange={(e) => {
                                    setSeason(Number(e.currentTarget.value));
                                }}
                            >
                                {seasons.map((s) => (
                                    <option value={s}>Season {s}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <VirtualCollection
                        key={`${item.id}:${currentSeason}`}
                        layout="episodes"
                        items={episodes}
                        render={(e) => (
                            <button
                                data-focus={e.id}
                                key={e.id}
                                class="episode"
                                onClick={() => tv.play(e)}
                            >
                                <span class="episode-number">
                                    {String(e.episode ?? 1).padStart(2, '0')}
                                </span>
                                <strong>{e.title}</strong>
                                <small>
                                    {tv.data.positions[e.id]?.seconds
                                        ? 'Resume episode'
                                        : 'Watch episode'}{' '}
                                    →
                                </small>
                            </button>
                        )}
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
