import { useSourceActions } from './use-source-actions';
import { usePlayerPlaylist } from './use-player-playlist';
import { HomeSourceStatus } from './home-source-status';
import { LiveOverlay, useLiveOverlay } from './live-overlay';
import { useLiveBrowse } from './use-live-browse';
import { useVodSequence } from './use-vod-sequence';
import { useHomeFeature } from './use-home-feature';
import { PageHeader } from './page-header';
import { Favorites } from './favorites';
import { History } from './history';
import { usePlayerControls } from './player-controls';
import { useEffect, useRef } from 'preact/hooks';
import { useTv } from './use-tv';
import { mainNavigation } from './navigation';
import { Sources } from './forms';
import { Settings } from './settings';
import type { TvBuildInfo } from './about';
import type { SettingsMemory } from './settings-navigation';
import { Home, CatalogScreen } from './screens';
import { Detail } from './detail';
import { useDetailSeason } from './use-detail-season';
import { Live } from './live';
import { Backdrop, TvIcon } from '@iptvnator/tv/ui';
import { useMetadata } from './use-metadata';
import { useSeriesContext } from './use-series-context';
import { useSeriesDetails } from './use-series-details';
import { NativePlayerView } from './native-player-view';
import { useTvRemote } from './use-tv-remote';
import { PersonPage } from './person-page';
import type { FilmographyMemory } from './use-filmography-search';
export function TvApp({ buildInfo }: { buildInfo: TvBuildInfo }) {
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
    const homeActions = useSourceActions(tv, seriesDetails);
    const back = () => {
        homeActions.leave();
        tv.back();
    };
    useTvRemote({
        back,
        stop: () => {
            homeActions.leave();
            tv.stop();
        },
        fullscreen: tv.fullscreen,
        player: tv.player.current,
        restore: tv.restorePlaybackFocus,
        startOver: tv.startOver,
    });
    useSeriesContext(tv);
    const browse = useLiveBrowse(tv);
    const overlay = useLiveOverlay(tv, browse);
    const playlist = usePlayerPlaylist(tv, browse);
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
    const vod = useVodSequence(tv);
    const feature = useHomeFeature(
        tv,
        homeActions.leave,
        vod.lists,
        vod.revision
    );
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
    const element = video.current;
    const controlsVisible = usePlayerControls(
        tv.fullscreen,
        !!overlay.panel || (element?.paused ?? true)
    );
    return (
        <div
            class={`tv-app ${tv.data.layout}`}
            onMouseMove={(event) => {
                if (!event.movementX && !event.movementY) return;
                const button = (event.target as HTMLElement).closest('button');
                if (
                    button &&
                    !button.hasAttribute('data-tv-pointer-only') &&
                    button !== document.activeElement
                )
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
                    {mainNavigation.map(([view, label]) => (
                        <button
                            data-focus={`nav:${view}`}
                            aria-current={r.view === view ? 'page' : undefined}
                            onClick={() => {
                                homeActions.leave();
                                tv.navigate(view);
                            }}
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
                <PageHeader tv={tv} cancelOpening={homeActions.leave} />
                <HomeSourceStatus actions={homeActions} />
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
                        <button
                            onClick={() => {
                                homeActions.leave();
                                tv.navigate('sources');
                            }}
                        >
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
                        actions={homeActions}
                        detailsBusy={seriesDetails.busy || homeActions.pending}
                    />
                ) : r.view === 'sources' ? (
                    <Sources tv={tv} />
                ) : r.view === 'settings' ? (
                    <Settings
                        tv={tv}
                        memory={settingsMemory.current}
                        buildInfo={buildInfo}
                    />
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
                    <Favorites tv={tv} actions={homeActions} />
                ) : r.view === 'history' ? (
                    <History tv={tv} actions={homeActions} />
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
                        metadataLoading={metadata.loading}
                        season={detailSeason.season}
                        selectSeason={detailSeason.select}
                    />
                ) : (
                    <CatalogScreen tv={tv} />
                )}
            </main>
            <NativePlayerView
                tv={tv}
                video={video}
                controlsVisible={controlsVisible}
                overlay={overlay}
                seriesDetails={seriesDetails}
                vod={vod}
                back={back}
                openPlaylist={() => {
                    homeActions.leave();
                    playlist.open();
                }}
                previousChannel={{
                    pending: homeActions.pending,
                    play: () =>
                        tv.previousChannel &&
                        homeActions.previous(tv.previousChannel),
                }}
            />
            <LiveOverlay tv={tv} browse={browse} overlay={overlay} />
        </div>
    );
}
