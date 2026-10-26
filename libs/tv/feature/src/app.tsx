import { LiveOverlay, useLiveOverlay } from './live-overlay';
import { useLiveBrowse } from './use-live-browse';
import { useHomeFeature } from './use-home-feature';
import { PageHeader } from './page-header';
import { Favorites } from './favorites';
import { usePlayerControls } from './player-controls';
import { useEffect, useRef } from 'preact/hooks';
import { useTv } from './use-tv';
import type { View } from './navigation';
import { Sources } from './forms';
import { Settings } from './settings';
import type { SettingsMemory } from './settings-navigation';
import { Home, CatalogScreen } from './screens';
import { Detail } from './detail';
import { useDetailSeason } from './use-detail-season';
import { Live } from './live';
import { Backdrop, TvIcon } from '@iptvnator/tv/ui';
import { useMetadata } from './use-metadata';
import { useSeriesContext } from './use-series-context';
import { useSeriesDetails } from './use-series-details';
import { mediaTitle } from '@iptvnator/tv/util';
import { PersonPage } from './person-page';
import type { FilmographyMemory } from './use-filmography-search';
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
    const personMemory = useRef<FilmographyMemory>(new WeakMap());
    const settingsMemory = useRef<SettingsMemory>({
        category: 'connection',
        controls: {},
        scroll: {},
    });
    const video = useRef<HTMLVideoElement>(null);
    const tv = useTv(video);
    const detailSeason = useDetailSeason(tv.route);
    const seriesDetails = useSeriesDetails(tv);
    useSeriesContext(tv);
    const browse = useLiveBrowse(tv);
    const overlay = useLiveOverlay(tv, browse);
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
        !!overlay.panel || (element?.paused ?? true)
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
            {!tv.storageReady ? (
                <section
                    class="source-form storage-recovery"
                    aria-label="Saved TV data"
                >
                    <h1>IPTVnator TV</h1>
                    {tv.storageError ? (
                        <>
                            <p role="alert">{tv.storageError}</p>
                            <button
                                autoFocus
                                onClick={() => void tv.retryStorage()}
                            >
                                Retry reading saved data
                            </button>
                        </>
                    ) : (
                        <p role="status">Loading saved TV data…</p>
                    )}
                </section>
            ) : null}
            <aside hidden={tv.fullscreen || !tv.storageReady}>
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
                hidden={tv.fullscreen || !tv.storageReady}
                class={
                    cinematic
                        ? `cinematic-page ${r.view}-page`
                        : r.view === 'settings'
                          ? 'settings-page'
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
                        {tv.errorRetry ? (
                            <button onClick={tv.errorRetry}>
                                {tv.errorRetryLabel}
                            </button>
                        ) : null}
                        <button onClick={() => tv.setError('')}>Dismiss</button>
                        <button onClick={() => tv.navigate('sources')}>
                            Edit sources
                        </button>
                    </div>
                ) : null}
                {tv.reconnectStatus ? (
                    <p role="status">{tv.reconnectStatus}</p>
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
                        openSeries={seriesDetails.open}
                        detailsBusy={seriesDetails.busy}
                    />
                ) : r.view === 'sources' ? (
                    <Sources tv={tv} />
                ) : r.view === 'settings' ? (
                    <Settings tv={tv} memory={settingsMemory.current} />
                ) : r.view === 'live' ? (
                    <Live
                        key={tv.data.activeId}
                        tv={tv}
                        browse={browse}
                        overlayOpen={overlay.panel === 'channels'}
                        openGuide={overlay.openGuide}
                        openGrid={overlay.openGrid}
                    />
                ) : r.view === 'favorites' ? (
                    <Favorites tv={tv} />
                ) : r.view === 'person' ? (
                    <PersonPage
                        key={`${tv.data.activeId}:${r.person?.tmdbId}`}
                        tv={tv}
                        client={metadata.client}
                        memory={personMemory.current}
                    />
                ) : r.view === 'detail' ? (
                    <Detail
                        key={r.item?.id}
                        tv={display}
                        metadataClient={metadata.client}
                        season={detailSeason.season}
                        selectSeason={detailSeason.select}
                    />
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
                        hidden={!!overlay.panel}
                    >
                        <div class="player-top">
                            <button data-focus="player-back" onClick={tv.back}>
                                ← Back
                            </button>
                            {current?.kind === 'live' ? (
                                <div class="actions">
                                    <button
                                        data-focus="player-channels"
                                        onClick={overlay.openChannels}
                                    >
                                        Channels
                                    </button>
                                    <button
                                        data-focus="player-grid"
                                        onClick={overlay.openGrid}
                                    >
                                        TV Guide
                                    </button>
                                    <button
                                        data-focus="player-guide"
                                        onClick={overlay.openGuide}
                                    >
                                        Programme
                                    </button>
                                </div>
                            ) : null}
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
                            <h1>{current && mediaTitle(current)}</h1>
                            {current?.kind === 'episode' ? (
                                <p>{current.title}</p>
                            ) : null}
                            <div class="actions">
                                <button
                                    data-focus="player-toggle"
                                    class="primary"
                                    onClick={() => tv.player.current?.toggle()}
                                >
                                    {element?.paused ? 'Play ▶' : 'Pause Ⅱ'}
                                </button>
                                {current?.kind === 'episode' ? (
                                    <button
                                        data-focus="player-series-details"
                                        disabled={seriesDetails.busy}
                                        onClick={() =>
                                            void seriesDetails.open(current)
                                        }
                                    >
                                        {seriesDetails.busy
                                            ? 'Finding series…'
                                            : 'Series details →'}
                                    </button>
                                ) : null}
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
                                    {tv.errorRetry ? (
                                        <button onClick={tv.errorRetry}>
                                            {tv.errorRetryLabel}
                                        </button>
                                    ) : null}
                                    <button onClick={() => tv.setError('')}>
                                        Dismiss
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
            <LiveOverlay tv={tv} browse={browse} overlay={overlay} />
        </div>
    );
}
