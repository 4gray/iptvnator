import { LiveChannels } from './live-channels';
import { useLiveBrowse } from './use-live-browse';
import { useEffect, useRef } from 'preact/hooks';
import { TvModel } from './use-tv';
export function Live({
    tv,
    browse,
    overlayOpen,
    openGuide,
    openGrid,
}: {
    tv: TvModel;
    browse: ReturnType<typeof useLiveBrowse>;
    overlayOpen: boolean;
    openGuide: () => void;
    openGrid: () => void;
}) {
    const guide = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (guide.current) guide.current.scrollTop = 0;
    }, [tv.selected?.id]);
    const selected = tv.selected;
    return (
        <div
            class="live-layout"
            onKeyDown={(event) => {
                if (
                    !tv.fullscreen &&
                    !browse.categoriesOpen &&
                    (event.keyCode === 461 ||
                        ['Escape', 'BrowserBack', 'Backspace'].includes(
                            event.key
                        ))
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    browse.back();
                }
            }}
        >
            {!overlayOpen ? <LiveChannels tv={tv} browse={browse} /> : <div />}
            <section class="live-information">
                <div class="preview-placeholder">
                    {tv.playing ? (
                        <button
                            class="preview-open"
                            data-focus="live-fullscreen"
                            onClick={() => {
                                if (tv.playing) void tv.play(tv.playing);
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
                    <div class="actions">
                        <button data-focus="live-grid-guide" onClick={openGrid}>
                            TV Guide
                        </button>
                        <button
                            data-focus="live-expand-guide"
                            onClick={openGuide}
                            disabled={!selected}
                        >
                            Expand guide ↗
                        </button>
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
                </div>
                <div
                    class="programme-list"
                    ref={guide}
                    tabIndex={0}
                    data-tv-scroll
                    data-focus="live-guide"
                    role="region"
                    aria-label="Programme guide"
                    onKeyDown={(event) => {
                        const pane = event.currentTarget;
                        const down =
                            event.key === 'ArrowDown' || event.keyCode === 40;
                        const up =
                            event.key === 'ArrowUp' || event.keyCode === 38;
                        if (down || (up && pane.scrollTop > 0)) {
                            event.preventDefault();
                            event.stopPropagation();
                            pane.scrollTop += down ? 100 : -100;
                        }
                    }}
                >
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
                </div>
            </section>
        </div>
    );
}
