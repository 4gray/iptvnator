import { useNotice } from './use-notice';
import { useReconnect } from './use-reconnect';
import { useLibrary } from './use-library';
import { useBackend } from './use-backend';
import { firstRoute, type Route, type View } from './navigation';
export type { View } from './navigation';
import { useUserData } from './user-data';
import { useContent } from './use-content';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useProvider } from './use-provider';
import { LatestRequest, Media, Source } from '@iptvnator/tv/util';
import {
    focusKey,
    installRemote,
    platformBack,
    restoreFocus,
} from '@iptvnator/tv/ui';
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
    const stack = useRef<{ route: Route; focus: string; scroll: number }[]>([]);
    const playerOrigin = useRef('');
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
    function open(item: Media) {
        playback.current.cancel();
        if (item.kind === 'live') {
            if (route.view !== 'live') {
                setRoute({ ...firstRoute(), view: 'live', kind: 'live' });
            }
            setSelected(item);
            void play(item);
            return;
        }
        stack.current.push({
            route,
            focus: focusKey(),
            scroll: document.querySelector('main')?.scrollTop ?? 0,
        });
        setSelected(item);
        setRoute({ ...route, view: 'detail', item });
        restoreFocus('detail-play', '', 0);
    }
    async function play(
        item: Media,
        category = route.category,
        origin = focusKey()
    ) {
        playback.current.cancel();
        failedResolution.current = undefined;
        if (playing?.id === item.id && item.kind === 'live') {
            if (!fullscreen) {
                playerOrigin.current = origin;
                setFullscreen(true);
                restoreFocus('player-toggle');
            }
            return true;
        }
        const lane = playback.current;
        const job = lane.start();
        setError('');
        try {
            const resolved = await provider.current!.resolve(item, job.signal);
            if (!lane.owns(job)) return false;
            playerOrigin.current = origin;
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
        }
    }
    function retryPlayback() {
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
            setPlaying(undefined);
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
            restoreFocus(playerOrigin.current, 'detail-play');
            return;
        }
        playback.current.cancel();
        const previous = stack.current.pop();
        if (previous) {
            pendingFocus.current = previous.focus;
            pendingScroll.current = previous.scroll;
            setSelected(previous.route.item);
            setRoute(previous.route);
        } else if (route.view !== 'home') navigate('home');
        else platformBack();
    }
    const latest = useRef({ back, fullscreen, player: player.current });
    latest.current = { back, fullscreen, player: player.current };
    useEffect(
        () =>
            installRemote(
                () => latest.current.back(),
                () => latest.current.fullscreen,
                (code) => {
                    const p = latest.current.player;
                    if (code === 415) p?.resume();
                    if (code === 19) p?.pause();
                    if (code === 413) latest.current.back();
                    if (code === 412) p?.seek(-10);
                    if (code === 417) p?.seek(10);
                }
            ),
        []
    );
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
        play,
        back,
        stop,
        favorite,
        saveSource,
        switchSource,
        update,
        retry: retryConnection,
    };
}
export type TvModel = ReturnType<typeof useTv>;
