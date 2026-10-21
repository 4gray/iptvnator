import { useState } from 'preact/hooks';
import { Empty, Hero, Pager, Poster } from '@iptvnator/tv/ui';
import { Media } from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function Detail({ tv }: { tv: TvModel }) {
    const [season, setSeason] = useState<number>();
    const [episodePage, setEpisodePage] = useState(0);
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
            <button data-focus="detail-back" onClick={tv.back}>
                ← Back
            </button>
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
                                {Boolean(tv.data.positions[item.id]?.seconds)
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
                                    setEpisodePage(0);
                                }}
                            >
                                {seasons.map((s) => (
                                    <option value={s}>Season {s}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <div class="episode-grid">
                        {episodes
                            .slice(episodePage * 30, (episodePage + 1) * 30)
                            .map((e) => (
                                <button
                                    data-focus={e.id}
                                    key={e.id}
                                    class="episode"
                                    onClick={() => tv.play(e)}
                                >
                                    <span class="episode-number">
                                        {String(e.episode ?? 1).padStart(
                                            2,
                                            '0'
                                        )}
                                    </span>
                                    <strong>{e.title}</strong>
                                    <small>
                                        {Boolean(
                                            tv.data.positions[e.id]?.seconds
                                        )
                                            ? 'Resume episode'
                                            : 'Watch episode'}{' '}
                                        →
                                    </small>
                                </button>
                            ))}
                    </div>
                    {!tv.busy && !episodes.length ? (
                        <Empty>
                            No episodes were supplied for this series.
                        </Empty>
                    ) : null}
                    <Pager
                        page={episodePage}
                        next={(episodePage + 1) * 30 < episodes.length}
                        previous={(n) => setEpisodePage((p) => p + n)}
                    />
                </section>
            ) : null}
        </>
    );
}
