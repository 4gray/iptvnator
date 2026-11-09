import { createRandomId } from '@iptvnator/shared/interfaces';
import {
    favoriteReferenceKey,
    type FavoriteList,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    FavoritesError,
    ServerFavorites,
    commitFavoriteResult,
    isSharedFavorite,
    mediaFavoriteReference,
    mergeFavoriteSource,
    pendingFavorites,
    queueFavorite,
    resolveFavoriteEntries,
    serverMemberKeys,
    sharedFavoriteCounts,
} from '@iptvnator/tv/data-access';
import { LatestRequest, type Media, type UserData } from '@iptvnator/tv/util';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Local favorites that can be shared: on a library-linked source and not an episode. */
export function shareableFavorites(data: UserData): Media[] {
    return data.favorites.filter(
        (item) =>
            item.kind !== 'episode' &&
            data.sources.some((s) => s.id === item.sourceId && s.libraryId)
    );
}

export function useFavoritesSync(
    data: UserData,
    ready: boolean,
    playing: boolean,
    update: (change: (data: UserData) => UserData) => Promise<void>
) {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const latest = useRef({ data, playing, update });
    latest.current = { data, playing, update };
    const lane = useRef(new LatestRequest());
    const running = useRef(false);

    const client = () => {
        const library = latest.current.data.library;
        return library
            ? new ServerFavorites(
                  library.url,
                  library.token,
                  library.instanceId
              )
            : undefined;
    };

    async function deliver(server: ServerFavorites, signal: AbortSignal) {
        for (;;) {
            const pending = pendingFavorites(latest.current.data);
            if (!pending.length) return;
            const { key, entry } = pending[0];
            const head = entry.record.pending[0];
            const result = await server.apply(
                head.address,
                head.operation,
                signal
            );
            await latest.current.update(
                (current) =>
                    commitFavoriteResult(
                        current,
                        key,
                        head.operation.operationId,
                        result
                    ).data
            );
        }
    }

    async function contextFor(
        server: ServerFavorites,
        sourceId: string,
        signal: AbortSignal
    ) {
        const cached =
            latest.current.data.sharedFavoriteContexts[sourceId];
        try {
            const context = await server.context(sourceId, signal);
            if (
                context.sourceIncarnation !== cached?.sourceIncarnation ||
                context.provider !== cached?.provider
            )
                await latest.current.update((current) => ({
                    ...current,
                    sharedFavoriteContexts: {
                        ...current.sharedFavoriteContexts,
                        [context.sourceId]: context,
                    },
                }));
            return context;
        } catch (error) {
            // Offline writes can reuse a verified incarnation; server
            // errors and job cancellation must not.
            if (
                cached &&
                !signal.aborted &&
                !(error instanceof FavoritesError)
            )
                return cached;
            throw error;
        }
    }

    async function sync(manual = false) {
        const snapshot = latest.current;
        if (snapshot.data.favoritesMode !== 'shared') return;
        const server = client();
        if (!server || running.current) return;
        if (snapshot.playing) {
            if (manual)
                setError('Stop playback before refreshing shared favorites.');
            return;
        }
        const job = lane.current.start();
        running.current = true;
        setBusy(true);
        setError('');
        try {
            await deliver(server, job.signal);
            for (const source of latest.current.data.sources) {
                if (!source.libraryId) continue;
                const context = await contextFor(
                    server,
                    source.libraryId,
                    job.signal
                );
                const entries: FavoriteList['entries'] = [];
                let cursor: string | undefined;
                do {
                    const page = await server.list(
                        source.libraryId,
                        job.signal,
                        cursor
                    );
                    entries.push(...page.entries);
                    cursor = page.cursor;
                } while (cursor);
                const media = await resolveFavoriteEntries(source, entries);
                await latest.current.update((current) =>
                    mergeFavoriteSource(
                        current,
                        source,
                        context,
                        entries,
                        media
                    )
                );
            }
            // Merges can unblock intents that were queued behind dead heads.
            await deliver(server, job.signal);
            if (lane.current.owns(job))
                setStatus(
                    `Synced · ${sharedFavoriteCounts(latest.current.data).members} shared`
                );
        } catch (failure) {
            if (lane.current.owns(job)) {
                setStatus('Not synchronized');
                setError(
                    failure instanceof FavoritesError
                        ? failure.message
                        : 'Shared favorites could not be synchronized.'
                );
            }
        } finally {
            if (lane.current.owns(job)) {
                running.current = false;
                setBusy(false);
            }
        }
    }

    /** Returns false so the caller stores the item as a TV-only favorite. */
    async function toggle(item: Media): Promise<boolean> {
        const snapshot = latest.current;
        if (snapshot.data.favoritesMode !== 'shared') return false;
        const source = snapshot.data.sources.find(
            (s) => s.id === item.sourceId
        );
        if (!source?.libraryId || item.kind === 'episode') return false;
        const server = client();
        if (!server) return false;
        try {
            const content = await mediaFavoriteReference(item, source);
            if (!content) return false;
            const abort = new AbortController();
            const context = await contextFor(
                server,
                source.libraryId,
                abort.signal
            );
            const member = isSharedFavorite(snapshot.data, item);
            if (
                !member &&
                snapshot.data.favorites.some((m) => m.id === item.id)
            )
                return false; // Local-only favorite: the local toggle removes it.
            await latest.current.update(
                (current) =>
                    queueFavorite(
                        current,
                        source,
                        item,
                        !member,
                        context,
                        content,
                        current.favoritesConsent,
                        current.favoritesDeviceId || 'tv'
                    ).data
            );
            if (!latest.current.playing) void sync();
            return true;
        } catch {
            setError('The shared favorite could not be changed.');
            return true;
        }
    }

    /** Uploads local favorites that the server does not already have. */
    async function uploadLocal(): Promise<number> {
        const server = client();
        if (!server || latest.current.data.favoritesMode !== 'shared')
            return 0;
        const abort = new AbortController();
        let imported = 0;
        for (const source of latest.current.data.sources) {
            if (!source.libraryId) continue;
            const context = await contextFor(
                server,
                source.libraryId,
                abort.signal
            );
            const entries: FavoriteList['entries'] = [];
            let cursor: string | undefined;
            do {
                const page = await server.list(
                    source.libraryId,
                    abort.signal,
                    cursor
                );
                entries.push(...page.entries);
                cursor = page.cursor;
            } while (cursor);
            const keys = serverMemberKeys(entries);
            for (const item of latest.current.data.favorites.filter(
                (m) => m.sourceId === source.id
            )) {
                const content = await mediaFavoriteReference(item, source);
                if (
                    !content ||
                    keys.has(favoriteReferenceKey(content)) ||
                    isSharedFavorite(latest.current.data, item)
                )
                    continue;
                await latest.current.update(
                    (current) =>
                        queueFavorite(
                            current,
                            source,
                            item,
                            true,
                            context,
                            content,
                            current.favoritesConsent,
                            current.favoritesDeviceId || 'tv'
                        ).data
                );
                imported++;
            }
        }
        await sync();
        return imported;
    }

    /** `uploadLocal` only applies when enabling; local rows are never deleted. */
    async function setShared(shared: boolean, uploadLocalFavorites = false) {
        try {
            if (!shared) {
                await latest.current.update((current) => ({
                    ...current,
                    favoritesMode: 'local',
                    favoritesConsent: '',
                }));
                setError('');
                setStatus('Favorites stay on this TV.');
                return;
            }
            if (!latest.current.data.library) {
                setError(
                    'Connect the server library before sharing favorites.'
                );
                return;
            }
            await latest.current.update((current) => ({
                ...current,
                favoritesMode: 'shared',
                favoritesConsent: createRandomId(),
                favoritesDeviceId:
                    current.favoritesDeviceId || createRandomId(),
            }));
            if (uploadLocalFavorites) await uploadLocal();
            else await sync();
        } catch {
            setError('Shared favorites could not be enabled.');
        }
    }

    const refresh = useRef(() => void sync());
    refresh.current = () => {
        if (
            !running.current &&
            !latest.current.playing &&
            document.visibilityState !== 'hidden'
        )
            void sync();
    };
    useEffect(() => {
        if (!ready || data.favoritesMode !== 'shared') return;
        refresh.current();
        const visible = () => refresh.current();
        const timer = setInterval(visible, 60000);
        document.addEventListener('visibilitychange', visible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', visible);
            lane.current.cancel();
            running.current = false;
        };
    }, [ready, data.favoritesMode]);

    return {
        busy,
        status,
        error,
        mode: data.favoritesMode,
        shareableCount: shareableFavorites(data).length,
        counts: sharedFavoriteCounts(data),
        toggle,
        setShared,
        uploadLocal,
        sync: () => sync(true),
    };
}
