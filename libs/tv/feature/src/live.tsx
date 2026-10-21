import { Empty, Pager } from '@iptvnator/tv/ui';
import { TvModel } from './use-tv';
export function Live({ tv }: { tv: TvModel }) {
    const r = tv.route;
    const selected = tv.selected;
    return (
        <>
            <h1>Live television</h1>
            <p class="muted">
                Choose a channel. Press OK to preview, and again to fill your
                screen.
            </p>
            <div class="live-layout">
                <section class="channel-pane">
                    <label>
                        Category
                        <select
                            value={r.category}
                            onChange={(e) =>
                                tv.setRoute({
                                    ...r,
                                    category: e.currentTarget.value,
                                    page: 0,
                                })
                            }
                        >
                            <option value="">All channels</option>
                            {tv.catalog.categories.map((c) => (
                                <option value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </label>
                    <div class="channels">
                        {tv.catalog.items.map((item, n) => (
                            <button
                                class={`channel ${tv.playing?.id === item.id && tv.player.current?.hasConfirmedPlayback ? 'is-playing' : ''}`}
                                data-focus={item.id}
                                aria-pressed={selected?.id === item.id}
                                onFocus={() => tv.setSelected(item)}
                                onClick={() => {
                                    tv.setSelected(item);
                                    tv.play(item);
                                }}
                            >
                                <span class="channel-number">
                                    {String(
                                        r.page * tv.catalog.items.length + n + 1
                                    ).padStart(2, '0')}
                                </span>
                                {item.poster ? (
                                    <img src={item.poster} alt="" />
                                ) : (
                                    <span class="channel-logo">
                                        {item.title.slice(0, 1)}
                                    </span>
                                )}
                                <span>
                                    <strong>{item.title}</strong>
                                    <small>
                                        {tv.playing?.id === item.id
                                            ? tv.player.current
                                                  ?.hasConfirmedPlayback
                                                ? '● Playing'
                                                : 'Starting / paused'
                                            : 'Live channel'}
                                    </small>
                                </span>
                            </button>
                        ))}
                    </div>
                    {!tv.busy && !tv.catalog.items.length ? (
                        <Empty>No channels in this category.</Empty>
                    ) : null}
                    <Pager
                        page={r.page}
                        next={
                            tv.catalog.items.length > 0 &&
                            (r.page + 1) * (tv.catalog.pageSize || 60) <
                                tv.catalog.total
                        }
                        previous={(delta) =>
                            tv.setRoute({ ...r, page: r.page + delta })
                        }
                    />
                </section>
                <section class="live-information">
                    <div class="preview-placeholder">
                        {tv.playing ? (
                            <button
                                class="preview-open"
                                onClick={() => {
                                    tv.setFullscreen(true);
                                }}
                                aria-label="Open fullscreen"
                            >
                                Fullscreen ↗
                            </button>
                        ) : (
                            <span>Select a channel to start preview</span>
                        )}
                    </div>
                    <div class="section-title">
                        <h2>{selected?.title ?? 'Programme guide'}</h2>
                        {selected ? (
                            <button
                                aria-label="Favorite channel"
                                onClick={() => tv.favorite(selected)}
                            >
                                {tv.data.favorites.some(
                                    (m) => m.id === selected.id
                                )
                                    ? '♥ Saved'
                                    : '♡ Save channel'}
                            </button>
                        ) : null}
                    </div>
                    {tv.data.epg ? (
                        <>
                            {tv.epg.slice(0, 12).map((p) => (
                                <div class="programme">
                                    <time>
                                        {new Date(p.start).toLocaleTimeString(
                                            [],
                                            {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            }
                                        )}
                                    </time>
                                    <div>
                                        <strong>{p.title}</strong>
                                        <small>
                                            {p.start <= Date.now() &&
                                            p.end > Date.now()
                                                ? 'Now playing'
                                                : new Date(
                                                      p.end
                                                  ).toLocaleTimeString([], {
                                                      hour: '2-digit',
                                                      minute: '2-digit',
                                                  })}
                                        </small>
                                    </div>
                                </div>
                            ))}
                            {!tv.epg.length ? (
                                <p class="muted">
                                    {tv.epgError ||
                                        'No programme information supplied.'}
                                </p>
                            ) : null}
                        </>
                    ) : null}
                </section>
            </div>
        </>
    );
}
