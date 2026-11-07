import { createSourceSwitcher } from './source-selection';
import { useNotice, connectionNotice } from './use-notice';
import { useReconnect } from './use-reconnect';
import { useLibrary } from './use-library';
import { useBackend } from './use-backend';
import { firstRoute, isSavedView, type View } from './navigation';
import { useRouteHistory, type NavigationOrigin } from './use-route-history';
import { usePlaybackOrigin, type FailedPlayback } from './use-playback-origin';
import { useUserData } from './user-data';
import { useContent } from './use-content';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useProvider } from './use-provider';
import { useSourceNavigation } from './use-source-navigation';
import {
    LatestRequest,
    Media,
    Source,
    resumeSeconds,
} from '@iptvnator/tv/util';
import { focusKey, platformBack, restoreFocus } from '@iptvnator/tv/ui';
export function useTv(video: { current: HTMLVideoElement | null }) {
    const [route, setRoute] = useState(firstRoute);
    const { error, errorRetry, errorRetryLabel, setError, clearError } =
        useNotice();
    const [connectionFailed, setConnectionFailed] = useState(false);
    const reportConnection = connectionNotice(
        { setError, clearError },
        setConnectionFailed,
        retryConnection
    );
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<Media>();
    const [playing, setPlaying] = useState<Media>();
    const [fullscreen, setFullscreen] = useState(false);
    const [, tick] = useState(0);
    const playback = useRef(new LatestRequest());
    const failedResolution = useRef<FailedPlayback>();
    const { stack, visit } = useRouteHistory(route, setRoute);
    const playerOrigin = usePlaybackOrigin();
    const playingCategory = useRef('');
    const pendingFocus = useRef('');
    const pendingScroll = useRef<number>();
    const user = useUserData(
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
            ),
        { setError, clearError }
    );
    const { data, storageReady, repo, player, update } = user;
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
    function cancelPlayback() {
        playback.current.cancel();
        clearError('Retry start over');
    }
    function stop() {
        clearError('Retry playback');
        failedResolution.current = undefined;
        cancelPlayback();
        player.current?.stop();
        setPlaying(undefined);
        setFullscreen(false);
    }
    function navigate(view: View) {
        if (view === 'live' && playing?.kind === 'live') cancelPlayback();
        else stop();
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
        cancelPlayback();
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
        cancelPlayback();
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
        origin: string | NavigationOrigin = focusKey(),
        signal?: AbortSignal,
        retryResolution?: { retry: () => void; label?: string },
        forceRestart = false
    ) {
        if (!ready || item.sourceId !== data.activeId || signal?.aborted)
            return false;
        const originAtStart =
            typeof origin === 'string' ? playerOrigin.capture(origin) : origin;
        cancelPlayback();
        failedResolution.current = undefined;
        if (!forceRestart && playing?.id === item.id && item.kind === 'live') {
            if (!fullscreen) {
                playerOrigin.remember(originAtStart);
                setFullscreen(true);
                restoreFocus('player-toggle');
            }
            return true;
        }
        const lane = playback.current;
        const job = lane.start();
        const revision = repo.current!.data.positions[item.id]?.revision ?? 0;
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
            if (item.kind === 'live') {
                playingCategory.current = category;
                if (isSavedView(route.view)) {
                    setSelected(item);
                    visit(
                        { ...firstRoute(), view: 'live', kind: 'live' },
                        item.id,
                        originAtStart
                    );
                }
            }
            if (item.kind !== 'live' || isSavedView(route.view)) {
                setFullscreen(true);
                restoreFocus('player-toggle');
            }
            const position = resumeSeconds(
                repo.current!.data.positions[item.id]
            );
            await player.current!.play(item, resolved, position, revision);
            return lane.owns(job);
        } catch {
            if (lane.owns(job)) {
                failedResolution.current = {
                    item,
                    category,
                    origin: originAtStart,
                };
                setError(
                    forceRestart && playing?.id === item.id
                        ? 'Playback could not be restarted.'
                        : 'Playback could not be resolved. Check the source and retry.',
                    retryResolution?.retry ?? retryPlayback,
                    retryResolution?.label ?? 'Retry playback'
                );
            }
            return false;
        } finally {
            signal?.removeEventListener('abort', cancel);
        }
    }
    function retryPlayback() {
        if (!ready) return;
        const failed = failedResolution.current;
        const item = failed?.item ?? playing;
        if (!failed && playing) player.current?.stop();
        if (item)
            void play(
                item,
                failed?.category ?? playingCategory.current,
                failed?.origin ?? playerOrigin.current,
                undefined,
                undefined,
                true
            );
    }
    async function startOver(
        item: Media,
        origin = fullscreen ? playerOrigin.current : playerOrigin.capture()
    ) {
        const lane = playback.current;
        const job = lane.start();
        try {
            await user.saveWatch(item, 'reset');
        } catch {
            if (lane.owns(job))
                setError(
                    'Viewing status was not saved. Free TV storage and retry.',
                    () => {
                        if (lane.owns(job)) void startOver(item, origin);
                    },
                    'Retry start over'
                );
            return false;
        }
        return lane.owns(job) && play(item, route.category, origin);
    }
    function back() {
        if (fullscreen) {
            const savedLive =
                playing?.kind === 'live' &&
                isSavedView(
                    stack.current[stack.current.length - 1]?.route.view
                );
            setFullscreen(false);
            if (playing?.kind !== 'live' || savedLive) stop();
            if (!savedLive) {
                playerOrigin.restore();
                return;
            }
        }
        cancelPlayback();
        const previous = stack.current.pop();
        if (previous || route.view !== 'home') content.cancelBrowse();
        if (previous) {
            if (route.view === 'live' && isSavedView(previous.route.view))
                stop();
            pendingFocus.current = previous.focus;
            pendingScroll.current = previous.scroll;
            setSelected(previous.route.item);
            setRoute(previous.route);
        } else if (route.view !== 'home') navigate('home');
        else platformBack();
    }
    const switchSource = createSourceSwitcher({
        stop,
        update,
        selected: () => {
            if (route.view === 'sources') navigate('home');
            else if (route.view === 'detail' || route.view === 'person') {
                navigate(
                    (route.item?.kind ?? route.kind) === 'movie'
                        ? 'movies'
                        : 'series'
                );
                restoreFocus('source-picker');
            }
        },
        clearError,
        setError,
    });
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
        ...user,
        library,
        guideClient: ready ? provider.current : undefined,
        retryPlayback,
        retryConnection,
        playbackOrigin: playerOrigin.current,
        restorePlaybackFocus: playerOrigin.restore,
        restoreKey: pendingFocus.current,
        restoreScroll: pendingScroll.current,
        backend,
        route,
        setRoute,
        error,
        errorRetry,
        errorRetryLabel,
        reconnectStatus: recovery.reconnectStatus,
        setError,
        clearError,
        ready,
        ...content,
        busy: busy || content.busy,
        selected,
        setSelected,
        playing,
        playingCategory: playingCategory.current,
        fullscreen,
        setFullscreen,
        navigate,
        open,
        openPerson,
        play,
        startOver,
        back,
        stop,
        saveSource,
        switchSource,
        playbackRequest: playback.current.signal,
    };
}
export type TvModel = ReturnType<typeof useTv>;
