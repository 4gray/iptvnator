import { useBackend } from './use-backend';
import { firstRoute, type Route, type View } from './navigation';
export type { View } from './navigation';
import { useUserData } from './user-data';
import { useContent } from './use-content';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createProvider, ProviderTransport } from '@iptvnator/tv/data-access';
import {
    LatestRequest,
    Media,
    ProviderClient,
    Source,
} from '@iptvnator/tv/util';
import {
    focusKey,
    installRemote,
    platformBack,
    restoreFocus,
} from '@iptvnator/tv/ui';
export function useTv(video: { current: HTMLVideoElement | null }) {
    const [route, setRoute] = useState(firstRoute);
    const [error, setError] = useState('');
    const [ready, setReady] = useState(0);
    const [retry, setRetry] = useState(0);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<Media>();
    const [playing, setPlaying] = useState<Media>();
    const [fullscreen, setFullscreen] = useState(false);
    const [, tick] = useState(0);
    const provider = useRef<ProviderClient>();
    const playback = useRef(new LatestRequest());
    const stack = useRef<{ route: Route; focus: string; scroll: number }[]>([]);
    const playerOrigin = useRef('');
    const pendingFocus = useRef('');
    const pendingScroll = useRef<number>();
    const { data, storageReady, repo, player, update } = useUserData(
        video,
        setError,
        () => tick((t) => t + 1)
    );
    const backend = useBackend(data, storageReady, update);
    const content = useContent(
        route,
        provider,
        ready,
        selected,
        setSelected,
        data.epg,
        setError,
        pendingFocus,
        data.activeId,
        pendingScroll,
        data.catalogSort
    );
    const report = () =>
        setError(
            'The request failed. Check your source and backend, then retry.'
        );
    useEffect(() => {
        if (!storageReady) return;
        if (!data.sources.length) {
            setRoute({ ...firstRoute(), view: 'sources' });
            restoreFocus('nav:sources');
        } else restoreFocus('nav:home');
    }, [storageReady]);
    const active = data.sources.find((s) => s.id === data.activeId);
    const fingerprint = active
        ? JSON.stringify([
              active.id,
              active.url,
              active.username,
              active.password,
              active.macAddress,
              active.serialNumber,
              active.deviceId1,
              active.deviceId2,
              active.signature1,
              active.signature2,
          ])
        : '';
    useEffect(() => {
        setReady(0);

        setSelected(undefined);
        setPlaying(undefined);

        playback.current.cancel();

        player.current?.stop();
        player.current?.clearDiagnostic();
        provider.current?.dispose();
        if (!storageReady || !active || !data.backend) return;
        const abort = new AbortController();
        const snapshot = { ...active };
        const client = createProvider(
            snapshot,
            new ProviderTransport(data.backend, data.backendToken),
            (source) =>
                update((d) => ({
                    ...d,
                    sources: d.sources.map((s) =>
                        s.id === source.id ? source : s
                    ),
                }))
        );
        provider.current = client;
        setBusy(true);
        setError('');
        client
            .connect(abort.signal)
            .then(() => {
                if (!abort.signal.aborted) setReady(retry + 1);
            })
            .catch(() => {
                if (!abort.signal.aborted) report();
            })
            .finally(() => {
                if (!abort.signal.aborted) setBusy(false);
            });
        return () => {
            abort.abort();
            client.dispose();
        };
    }, [fingerprint, data.backend, data.backendToken, storageReady, retry]);
    function stop() {
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
    async function play(item: Media) {
        if (playing?.id === item.id && item.kind === 'live') {
            playerOrigin.current = focusKey();
            setFullscreen(true);
            restoreFocus('player-toggle');
            return;
        }
        const lane = playback.current;
        const job = lane.start();
        setError('');
        try {
            const resolved = await provider.current!.resolve(item, job.signal);
            if (!lane.owns(job)) return;
            playerOrigin.current = focusKey();
            setPlaying(item);
            if (item.kind !== 'live') {
                setFullscreen(true);
                restoreFocus('player-toggle');
            }
            const p = repo.current!.data.positions[item.id];
            await player.current!.play(
                item,
                resolved,
                p && p.duration - p.seconds > 15 ? p.seconds : 0
            );
        } catch {
            if (lane.owns(job))
                setError(
                    'Playback could not be resolved. Check the source and retry.'
                );
        }
    }
    function retryPlayback() {
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
                        void player.current?.play(item, resolved, 0);
                    }
                })
                .catch(() => setError('Playback could not be restarted.'));
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
        } catch {
            setError('Favorite was not saved. Free TV storage and retry.');
        }
    }
    async function switchSource(activeId: string) {
        stop();
        try {
            await update((d) => ({ ...d, activeId }));
            navigate('home');
        } catch {
            setError('Source selection was not saved.');
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
            navigate('home');
        } catch {
            setError('Source was not saved. Free TV storage and retry.');
        }
    }
    return {
        retryPlayback,
        restoreKey: pendingFocus.current,
        restoreScroll: pendingScroll.current,
        backend,
        data,
        route,
        setRoute,
        error,
        setError,
        ready,
        ...content,
        busy: busy || content.busy,
        selected,
        setSelected,
        playing,
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
        retry: () => setRetry((n) => n + 1),
    };
}
export type TvModel = ReturnType<typeof useTv>;
