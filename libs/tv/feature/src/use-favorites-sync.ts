import { useEffect, useRef, useState } from 'preact/hooks';
import { createRandomId } from '@iptvnator/shared/interfaces';
import { favoriteAddressKey } from '@iptvnator/shared/interfaces/favorites-sync';
import {
    FavoritesError,
    mediaFavoriteReference,
    queueFavorite,
    discardFavoriteIntents,
    sharedFavoriteCounts,
    type UserDataRepository,
    favoriteItems,
} from '@iptvnator/tv/data-access';
import {
    contextFor,
    deliver,
    ownsLibrary,
    ownsSource,
    refreshSources,
    retireContext,
    serverFor,
} from './favorites-network';
import { LatestRequest, type Media, type UserData } from '@iptvnator/tv/util';

export function useFavoritesSync(
    data: UserData,
    ready: boolean,
    playing: boolean,
    repo: UserDataRepository,
    saveLocal: (item: Media) => Promise<void>
) {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const isPlaying = useRef(playing);
    isPlaying.current = playing;
    const lane = useRef(new LatestRequest());
    const running = useRef<AbortController>();
    const sendAgain = useRef(false);

    async function run(upload = false, manual = false) {
        const start = repo.data;
        const server = serverFor(start);
        if (start.favoritesMode !== 'shared' || !server) return;
        if (running.current) return;
        if (isPlaying.current) {
            if (manual)
                setError('Stop playback before refreshing shared favorites.');
            return;
        }
        const job = lane.current.start();
        running.current = job;
        setBusy(true);
        setError('');
        try {
            await server.verify(job.signal);
            const unresolved = await refreshSources(
                repo,
                server,
                start,
                job.signal
            );
            const skipped = upload ? await uploadLocal(start, job.signal) : 0;
            await deliver(repo, server, start, job.signal);
            if (lane.current.owns(job) && ownsLibrary(repo.data, start))
                setStatus(
                    [
                        'Synced',
                        unresolved
                            ? `${unresolved} unavailable from the playlist`
                            : '',
                        skipped ? `${skipped} TV favorites kept local` : '',
                    ]
                        .filter(Boolean)
                        .join(' · ')
                );
        } catch (failure) {
            if (lane.current.owns(job) && ownsLibrary(repo.data, start)) {
                setStatus('Not synchronized');
                setError(
                    failure instanceof FavoritesError
                        ? failure.message
                        : 'Shared favorites could not be synchronized.'
                );
            }
        } finally {
            if (running.current === job) {
                running.current = undefined;
                setBusy(false);
                if (sendAgain.current) {
                    sendAgain.current = false;
                    void run();
                }
            }
        }
    }

    async function toggle(item: Media): Promise<boolean> {
        const start = repo.data;
        const source = start.sources.find(
            (candidate) => candidate.id === item.sourceId
        );
        const server = serverFor(start);
        if (
            start.favoritesMode !== 'shared' ||
            !server ||
            !source?.libraryId ||
            item.kind === 'episode'
        )
            return false;
        const content = await mediaFavoriteReference(item, source);
        if (!content) return false;
        const sourceId = source.libraryId;
        const savedContext = start.sharedFavoriteContexts[sourceId];
        const signal = new AbortController().signal;
        let handled = true;
        try {
            const context = await server
                .verify(signal)
                .then(() => contextFor(server, start, source, signal))
                .catch((failure: unknown) => {
                    if (savedContext && !(failure instanceof FavoritesError))
                        return savedContext;
                    throw failure;
                });
            await repo.update((current) => {
                if (
                    !ownsLibrary(current, start) ||
                    !ownsSource(current, source)
                )
                    return current;
                const cached = current.sharedFavoriteContexts[sourceId];
                if (
                    cached &&
                    cached.sourceIncarnation !==
                        savedContext?.sourceIncarnation &&
                    cached.sourceIncarnation !== context.sourceIncarnation
                )
                    return current;
                const key = favoriteAddressKey({
                    instanceId: server.instanceId,
                    scope: 'shared',
                    sourceId,
                    sourceIncarnation: context.sourceIncarnation,
                    content,
                });
                const existing = current.sharedFavorites[key]?.record;
                if (
                    !existing?.state.member &&
                    !existing?.base.revision &&
                    !existing?.pending.length &&
                    current.favorites.some(
                        (favorite) => favorite.id === item.id
                    )
                ) {
                    handled = false;
                    return current;
                }
                const next = {
                    ...current,
                    sharedFavoriteContexts: {
                        ...current.sharedFavoriteContexts,
                        [sourceId]: context,
                    },
                };
                return queueFavorite(
                    next,
                    source,
                    item,
                    !existing?.state.member,
                    context,
                    content,
                    start.favoritesConsent,
                    current.favoritesDeviceId
                ).data;
            });
            if (handled) {
                if (running.current) sendAgain.current = true;
                else void run();
            }
        } catch (failure) {
            if (failure instanceof FavoritesError && failure.sourceRetired)
                await retireContext(repo, start, sourceId, signal).catch(
                    () => undefined
                );
            setError('The shared favorite could not be changed.');
        }
        return handled;
    }

    async function uploadLocal(start: UserData, signal: AbortSignal) {
        let skipped = 0;
        for (const item of start.favorites) {
            if (signal.aborted || !ownsLibrary(repo.data, start)) break;
            const source = start.sources.find(
                (candidate) => candidate.id === item.sourceId
            );
            const context =
                source?.libraryId &&
                repo.data.sharedFavoriteContexts[source.libraryId];
            const content =
                source &&
                context &&
                (await mediaFavoriteReference(item, source));
            if (!source || !context || !content) {
                skipped++;
                continue;
            }
            await repo.update((current) => {
                if (
                    signal.aborted ||
                    !ownsLibrary(current, start) ||
                    !ownsSource(current, source) ||
                    current.sharedFavoriteContexts[context.sourceId]
                        ?.sourceIncarnation !== context.sourceIncarnation
                )
                    return current;
                const record =
                    current.sharedFavorites[
                        favoriteAddressKey({
                            instanceId: start.library!.instanceId,
                            scope: 'shared',
                            sourceId: context.sourceId,
                            sourceIncarnation: context.sourceIncarnation,
                            content,
                        })
                    ]?.record;
                if (record?.state.member) return current;
                if (record?.base.revision || record?.pending.length) {
                    skipped++;
                    return current;
                }
                return queueFavorite(
                    current,
                    source,
                    item,
                    true,
                    context,
                    content,
                    start.favoritesConsent,
                    current.favoritesDeviceId
                ).data;
            });
        }
        return skipped;
    }

    async function setShared(shared: boolean, upload = false) {
        const start = repo.data;
        const server = serverFor(start);
        if (!server || (start.favoritesMode === 'shared') === shared) return;
        const job = lane.current.start();
        running.current = job;
        setBusy(true);
        setError('');
        setStatus('');
        const consent = shared ? createRandomId() : '';
        try {
            if (shared) await server.verify(job.signal);
            await repo.update((current) =>
                lane.current.owns(job) && ownsLibrary(current, start)
                    ? discardFavoriteIntents({
                          ...current,
                          favoritesMode: shared ? 'shared' : 'local',
                          favoritesConsent: consent,
                          favoritesDeviceId:
                              current.favoritesDeviceId || createRandomId(),
                      })
                    : current
            );
        } catch (failure) {
            if (lane.current.owns(job))
                setError(
                    failure instanceof FavoritesError
                        ? failure.message
                        : 'Shared favorites settings could not be saved.'
                );
        } finally {
            if (running.current === job) {
                running.current = undefined;
                setBusy(false);
            }
        }
        if (
            shared &&
            lane.current.owns(job) &&
            repo.data.favoritesConsent === consent
        )
            await run(upload);
    }

    const refresh = useRef<() => void>(() => undefined);
    refresh.current = () => {
        if (document.visibilityState !== 'hidden') void run();
    };
    useEffect(() => {
        if (!ready || data.favoritesMode !== 'shared' || !data.library) return;
        const visible = () => refresh.current();
        const timer = setInterval(visible, 60000);
        document.addEventListener('visibilitychange', visible);
        visible();
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', visible);
        };
    }, [
        ready,
        data.favoritesMode,
        data.library?.instanceId,
        data.library?.url,
        data.library?.token,
    ]);
    useEffect(() => {
        if (playing) lane.current.cancel();
    }, [playing]);
    useEffect(() => {
        if (running.current && !repo.data.library) lane.current.cancel();
    }, [data.library?.instanceId]);
    useEffect(() => () => lane.current.cancel(), []);

    const visible = favoriteItems(data);
    const favoritesSync = {
        busy,
        status,
        error,
        mode: data.favoritesMode,
        shareableCount: data.favorites.filter(
            (item) =>
                item.kind !== 'episode' &&
                data.sources.some(
                    (source) => source.id === item.sourceId && source.libraryId
                )
        ).length,
        counts: sharedFavoriteCounts(data),
        setShared,
        uploadLocal: () => run(true, true),
        sync: () => run(false, true),
    };
    return {
        favoritesSync,
        favorite: async (item: Media) => {
            if (!(await toggle(item))) await saveLocal(item);
        },
        isFavorite: (item: Media) =>
            visible.some((favorite) => favorite.id === item.id),
        favoriteItems: () => visible,
    };
}
