import { useNotice } from './use-notice';
import { useReconnect } from './use-reconnect';
import { useLibrary } from './use-library';
import { useBackend } from './use-backend';
import { firstRoute, type View } from './navigation';
import { useRouteHistory, type NavigationOrigin } from './use-route-history';
import { usePlaybackOrigin } from './use-playback-origin';
import { useUserData } from './user-data';
import { useContent } from './use-content';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useProvider } from './use-provider';
import { useSourceNavigation } from './use-source-navigation';
import { useTvRemote } from './use-tv-remote';
import { LatestRequest, Media, Source } from '@iptvnator/tv/util';
import { focusKey, platformBack, restoreFocus } from '@iptvnator/tv/ui';
export function useTv(video: { current: HTMLVideoElement | null }) {
    const [route, setRoute] = useState(firstRoute);
    const { error, errorRetry, errorRetryLabel, setError, clearError } =
        useNotice();
    const [connectionFailed, setConnectionFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<Media>();
    const [playing, setPlaying] = useState<Media>();
    const [fullscreen, setFullscreen] = useState(false);
    const [, tick] = useState(0);
    const playback = useRef(new LatestRequest());
    const failedResolution = useRef<{
        item: Media;
        category: string;
        origin: string;
    }>();
    const { stack, visit } = useRouteHistory(route, setRoute);
    const playerOrigin = usePlaybackOrigin();
    const playingCategory = useRef('');
    const pendingFocus = useRef('');
    const pendingScroll = useRef<number>();
    const {
        data,
        storageReady,
        storageError,
        retryStorage,
        repo,
        player,
        update,
    } = useUserData(
        video,
        (message) => setError(message, retryPlayback, 'Retry playback'),
        () => tick((t) => t + 1),
        (message, retrySave) =>
            setError(
                message,
                () => {
                    void retrySave()
                        .then(() => clearError('Retry saving progress'))
                        .catch(() => undefined);
                },
                'Retry saving progress'
            )
    );
    useSourceNavigation(data.activeId, route, setRoute, () => {
        stack.current = [];
        pendingFocus.current = '';
        pendingScroll.current = undefined;
    });
    const library = useLibrary(data, storageReady, !!playing, update);
    const backend = useBackend(data, storageReady, update);
    const { provider, ready, busy, connectionKey, enabled } = useProvider(
        data,
        storageReady,
        retry,
        {
            update,
            report: reportConnection,
            reset: () => {
                stop();
                setSelected(undefined);
                player.current?.clearDiagnostic();
            },
        }
    );
    const content = useContent(
        route,
        provider,
        ready,
        selected,
        setSelected,
        data.epg,
        reportConnection,
        pendingFocus,
        data.activeId,
        pendingScroll,
        data.catalogSort
    );
    function reportConnection(message: string) {
        setConnectionFailed(!!message);
        if (message) setError(message, retryConnection, 'Retry connection');
        else clearError('Retry connection');
    }
    function retryConnection() {
        recovery.resetReconnect();
        setRetry((n) => n + 1);
    }
    useEffect(() => {
        if (!storageReady) return;
        if (!data.sources.length) {
            setRoute({ ...firstRoute(), view: 'sources' });
            restoreFocus('nav:sources');
        } else restoreFocus('nav:home');
    }, [storageReady]);
    const recovery = useReconnect({
        key: connectionKey,
        enabled,
        failed: connectionFailed,
        busy,
        playing: !!playing,
        ready,
        retry: () => setRetry((n) => n + 1),
    });
    function stop() {
        clearError('Retry playback');
        failedResolution.current = undefined;
        playback.current.cancel();
        player.current?.stop();
        setPlaying(undefined);
        setFullscreen(false);
    }
    function navigate(view: View) {
        playback.current.cancel();
        if (view !== 'live' || playing?.kind !== 'live') stop();
        stack.current = [];
        pendingFocus.current = '';
        setRoute({
            ...firstRoute(),
            view,
            kind:
                view === 'live'
                    ? 'live'
                    : view === 'series'
                      ? 'series'
                      : 'movie',
        });
        restoreFocus(`nav:${view}`, '', 0);
    }
    function open(item: Media, origin?: NavigationOrigin) {
        if (item.sourceId !== data.activeId) return;
        playback.current.cancel();
        if (item.kind === 'live') {
            if (route.view !== 'live') {
                setRoute({ ...firstRoute(), view: 'live', kind: 'live' });
            }
            setSelected(item);
            void play(item);
            return;
        }
        visit({ ...route, view: 'detail', item }, 'detail-play', origin);
        setSelected(item);
    }
    function openPerson(person: { tmdbId: number; name: string }) {
        playback.current.cancel();
        if (
            !data.activeId ||
            !Number.isInteger(person.tmdbId) ||
            person.tmdbId <= 0
        )
            return;
        visit(
            {
                ...route,
                view: 'person',
                person: { ...person, sourceId: data.activeId },
            },
            'person-back'
        );
    }
    async function play(
        item: Media,
        category = route.category,
        origin = focusKey(),
        signal?: AbortSignal
    ) {
        if (!ready || item.sourceId !== data.activeId || signal?.aborted)
            return false;
        const originAtStart = playerOrigin.capture(origin);
        playback.current.cancel();
        failedResolution.current = undefined;
        if (playing?.id === item.id && item.kind === 'live') {
            if (!fullscreen) {
                playerOrigin.remember(originAtStart);
                setFullscreen(true);
                restoreFocus('player-toggle');
            }
            return true;
        }
        const lane = playback.current;
        const job = lane.start();
        const cancel = () => {
            if (lane.owns(job)) lane.cancel();
        };
        signal?.addEventListener('abort', cancel);
        setError('');
        try {
            const resolved = await provider.current!.resolve(item, job.signal);
            if (!lane.owns(job)) return false;
            playerOrigin.remember(originAtStart);
            setPlaying(item);
            if (item.kind === 'live') playingCategory.current = category;
            if (item.kind !== 'live') {
                setFullscreen(true);
                restoreFocus('player-toggle');
            }
            const p = repo.current!.data.positions[item.id];
            await player.current!.play(
                item,
                resolved,
                p && (!p.duration || p.duration - p.seconds > 15)
                    ? p.seconds
                    : 0
            );
            return lane.owns(job);
        } catch {
            if (lane.owns(job)) {
                failedResolution.current = { item, category, origin };
                setError(
                    'Playback could not be resolved. Check the source and retry.',
                    retryPlayback,
                    'Retry playback'
                );
            }
            return false;
        } finally {
            signal?.removeEventListener('abort', cancel);
        }
    }
    function retryPlayback() {
        if (!ready) return;
        if (failedResolution.current) {
            void play(
                failedResolution.current.item,
                failedResolution.current.category,
                failedResolution.current.origin
            );
            return;
        }
        if (playing) {
            const item = playing;
            player.current?.stop();
            const job = playback.current.start();
            provider.current
                ?.resolve(item, job.signal)
                .then((resolved) => {
                    if (playback.current.owns(job)) {
                        setError('');
                        setPlaying(item);
                        const p = repo.current!.data.positions[item.id];
                        void player.current?.play(
                            item,
                            resolved,
                            p && (!p.duration || p.duration - p.seconds > 15)
                                ? p.seconds
                                : 0
                        );
                    }
                })
                .catch(() => {
                    if (playback.current.owns(job))
                        setError(
                            'Playback could not be restarted.',
                            retryPlayback,
                            'Retry playback'
                        );
                });
        }
    }
    function back() {
        if (fullscreen) {
            setFullscreen(false);
            if (playing?.kind !== 'live') stop();
            playerOrigin.restore();
            return;
        }
        playback.current.cancel();
        const previous = stack.current.pop();
        if (previous || route.view !== 'home') content.cancelBrowse();
        if (previous) {
            pendingFocus.current = previous.focus;
            pendingScroll.current = previous.scroll;
            setSelected(previous.route.item);
            setRoute(previous.route);
        } else if (route.view !== 'home') navigate('home');
        else platformBack();
    }
    function stopRemote() {
        stop();
        if (fullscreen)
            playerOrigin.restore(
                playing?.kind === 'live' ? playing.id : 'detail-play'
            );
    }
    useTvRemote({
        back,
        stop: stopRemote,
        fullscreen,
        player: player.current,
    });
    async function favorite(item: Media) {
        try {
            await update((d) => ({
                ...d,
                favorites: d.favorites.some((m) => m.id === item.id)
                    ? d.favorites.filter((m) => m.id !== item.id)
                    : [...d.favorites, item],
            }));
            clearError('Retry saving favorite');
        } catch {
            setError(
                'Favorite was not saved. Free TV storage and retry.',
                () => void favorite(item),
                'Retry saving favorite'
            );
        }
    }
    async function switchSource(activeId: string) {
        stop();
        try {
            await update((d) => ({ ...d, activeId }));
            clearError('Retry source selection');
            navigate('home');
        } catch {
            setError(
                'Source selection was not saved.',
                () => void switchSource(activeId),
                'Retry source selection'
            );
        }
    }
    async function saveSource(source: Source, address: string) {
        try {
            if (!(await backend.connect(address))) return;
            await update((d) => ({
                ...d,
                sources: [
                    ...d.sources.filter((s) => s.id !== source.id),
                    source,
                ],
                activeId: source.id,
            }));
            setRetry((n) => n + 1);
            clearError('Retry saving source');
            navigate('home');
        } catch {
            setError(
                'Source was not saved. Free TV storage and retry.',
                () => void saveSource(source, address),
                'Retry saving source'
            );
        }
    }
    return {
        storageReady,
        storageError,
        retryStorage,
        library,
        guideClient: ready ? provider.current : undefined,
        retryPlayback,
        playbackOrigin: playerOrigin.current,
        restoreKey: pendingFocus.current,
        restoreScroll: pendingScroll.current,
        backend,
        data,
        route,
        setRoute,
        error,
        errorRetry,
        errorRetryLabel,
        reconnectStatus: recovery.reconnectStatus,
        setError,
        ready,
        ...content,
        busy: busy || content.busy,
        selected,
        setSelected,
        playing,
        playingCategory: playingCategory.current,
        fullscreen,
        setFullscreen,
        player,
        navigate,
        open,
        openPerson,
        play,
        back,
        stop,
        favorite,
        saveSource,
        switchSource,
        update,
        playbackRequest: playback.current.signal,
    };
}
export type TvModel = ReturnType<typeof useTv>;
