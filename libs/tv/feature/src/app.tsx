import { useHomeFeature } from './use-home-feature';
import { PageHeader } from './page-header';
import { Favorites } from './favorites';
import { usePlayerControls } from './player-controls';
import { useEffect, useRef } from 'preact/hooks';
import { useTv, View } from './use-tv';
import { Sources } from './forms';
import { Settings } from './settings';
import { Home, CatalogScreen } from './screens';
import { Detail } from './detail';
import { Live } from './live';
import { Backdrop, TvIcon } from '@iptvnator/tv/ui';
import { useMetadata } from './use-metadata';
const navigation: [View, string][] = [
    ['home', 'Home'],
    ['live', 'TV'],
    ['movies', 'Movies'],
    ['series', 'Series'],
    ['favorites', 'Favorites'],
    ['search', 'Search'],
    ['sources', 'Sources'],
    ['settings', 'Settings'],
];
export function TvApp() {
    const video = useRef<HTMLVideoElement>(null);
    const tv = useTv(video);
    useEffect(() => {
        const position = () => {
            const rect = document
                .querySelector('.preview-placeholder')
                ?.getBoundingClientRect();
            const frame = document.querySelector<HTMLElement>(
                '.native-player.preview'
            );
            if (rect && frame)
                Object.assign(frame.style, {
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`,
                });
        };
        position();
        window.addEventListener('resize', position);
        document.addEventListener('scroll', position, true);
        return () => {
            window.removeEventListener('resize', position);
            document.removeEventListener('scroll', position, true);
        };
    });
    const r = tv.route;
    const feature = useHomeFeature(tv);
    const cinematic = r.view === 'home' || r.view === 'detail';
    const metadata = useMetadata(
        r.view === 'detail'
            ? tv.selected
            : r.view === 'home'
              ? feature.item
              : undefined,
        tv.data.tmdb
    );
    const display = {
        ...tv,
        selected: r.view === 'detail' ? metadata.item : tv.selected,
        home:
            r.view === 'home' && metadata.item
                ? tv.home.map((item) =>
                      item.id === metadata.item?.id ? metadata.item : item
                  )
                : tv.home,
    };
    const current = tv.playing;
    const element = video.current;
    const controlsVisible = usePlayerControls(
        tv.fullscreen,
        element?.paused ?? true
    );
    const time = (seconds: number) =>
        Number.isFinite(seconds)
            ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
            : 'LIVE';
    return (
        <div
            class={`tv-app ${tv.data.layout}`}
            onMouseMove={(event) => {
                if (!event.movementX && !event.movementY) return;
                const button = (event.target as HTMLElement).closest('button');
                if (button && button !== document.activeElement)
                    button.focus({ preventScroll: true });
            }}
        >
            <aside hidden={tv.fullscreen}>
                <div class="wordmark">
                    ip<span>tv</span>nator<small>TV EDITION</small>
                </div>
                <nav aria-label="Main navigation">
                    {navigation.map(([view, label]) => (
                        <button
                            data-focus={`nav:${view}`}
                            aria-current={r.view === view ? 'page' : undefined}
                            onClick={() => tv.navigate(view)}
                        >
                            <span class="nav-icon" aria-hidden="true">
                                <TvIcon name={view} />
                            </span>
                            {label}
                        </button>
                    ))}
                </nav>
                <div class="side-caption">
                    YOUR SOURCES.
                    <br />
                    YOUR SCREEN.
                </div>
            </aside>
            <main
                hidden={tv.fullscreen}
                class={
                    cinematic
                        ? `cinematic-page ${r.view}-page`
                        : r.view === 'live'
                          ? 'live-page'
                          : ''
                }
            >
                {cinematic ? <Backdrop item={metadata.item} /> : null}
                <PageHeader tv={tv} />
                {metadata.failed ? (
                    <div class="metadata-notice" role="status">
                        TMDB is unavailable. Showing provider information.
                        <button onClick={metadata.retry}>Retry metadata</button>
                    </div>
                ) : null}
                {tv.error ? (
                    <div role="alert" class="error">
                        <span>{tv.error}</span>
                        <button onClick={tv.retry}>Retry connection</button>
                        <button onClick={() => tv.navigate('sources')}>
                            Edit sources
                        </button>
                    </div>
                ) : null}
                {tv.busy ? (
                    <div class="loading" role="status">
                        Connecting to your source…
                    </div>
                ) : null}
                {r.view === 'home' ? (
                    <Home
                        tv={display}
                        feature={{ ...feature, item: metadata.item }}
                    />
                ) : r.view === 'sources' ? (
                    <Sources tv={tv} />
                ) : r.view === 'settings' ? (
                    <Settings tv={tv} />
                ) : r.view === 'live' ? (
                    <Live key={tv.data.activeId} tv={tv} />
                ) : r.view === 'favorites' ? (
                    <Favorites tv={tv} />
                ) : r.view === 'detail' ? (
                    <Detail key={r.item?.id} tv={display} />
                ) : (
                    <CatalogScreen tv={tv} />
                )}
            </main>
            <div
                class={`native-player ${tv.fullscreen ? 'fullscreen' : 'preview'}`}
                hidden={!current}
            >
                <video ref={video} playsInline preload="metadata" />
                {tv.fullscreen ? (
                    <div
                        class={`player-controls ${controlsVisible || tv.error ? '' : 'dormant'}`}
                    >
                        <div class="player-top">
                            <button data-focus="player-back" onClick={tv.back}>
                                ← Back
                            </button>
                            <span>
                                {current?.kind === 'live'
                                    ? 'LIVE TELEVISION'
                                    : 'NOW WATCHING'}
                            </span>
                        </div>
                        <div class="player-bottom">
                            <span class="eyebrow">
                                {current?.season
                                    ? `SEASON ${current.season} · EPISODE ${current.episode}`
                                    : 'IPTVNATOR TV'}
                            </span>
                            <h1>{current?.title}</h1>
                            <div class="actions">
                                <button
                                    data-focus="player-toggle"
                                    class="primary"
                                    onClick={() => tv.player.current?.toggle()}
                                >
                                    {element?.paused ? 'Play ▶' : 'Pause Ⅱ'}
                                </button>
                                {current?.kind !== 'live' ? (
                                    <>
                                        <button
                                            onClick={() =>
                                                tv.player.current?.seek(-10)
                                            }
                                        >
                                            −10 sec
                                        </button>
                                        <button
                                            onClick={() =>
                                                tv.player.current?.seek(10)
                                            }
                                        >
                                            +10 sec
                                        </button>
                                        <span>
                                            {time(element?.currentTime ?? 0)} /{' '}
                                            {time(element?.duration ?? 0)}
                                        </span>
                                    </>
                                ) : null}
                                <button
                                    onClick={() =>
                                        current && tv.favorite(current)
                                    }
                                >
                                    ♡ Save
                                </button>
                            </div>
                            {current?.kind !== 'live' ? (
                                <label class="seek">
                                    Playback position
                                    <input
                                        aria-label="Playback position"
                                        type="range"
                                        min="0"
                                        max={
                                            Number.isFinite(element?.duration)
                                                ? element!.duration
                                                : 0
                                        }
                                        value={element?.currentTime ?? 0}
                                        onInput={(e) => {
                                            tv.player.current?.seekTo(
                                                Number(e.currentTarget.value)
                                            );
                                        }}
                                    />
                                </label>
                            ) : null}
                            {tv.player.current?.restoringPosition ? (
                                <p role="status">Restoring saved position…</p>
                            ) : null}
                            {tv.error ? (
                                <div role="alert" class="error">
                                    {tv.error}
                                    <button onClick={tv.retryPlayback}>
                                        Retry playback
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
