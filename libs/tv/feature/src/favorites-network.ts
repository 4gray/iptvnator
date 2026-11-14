import {
    commitFavoriteResult,
    FavoritesError,
    mergeFavoriteSource,
    pendingFavorites,
    ProviderTransport,
    resolveFavoriteEntries,
    ServerFavorites,
    type FavoriteSourceContext,
    type UserDataRepository,
} from '@iptvnator/tv/data-access';
import { favoriteAddressKey } from '@iptvnator/shared/interfaces/favorites-sync';
import type { Media, Source, UserData } from '@iptvnator/tv/util';

export function serverFor(data: UserData) {
    const library = data.library;
    return (
        library &&
        new ServerFavorites(library.url, library.token, library.instanceId)
    );
}

export function ownsLibrary(current: UserData, start: UserData) {
    return (
        !!current.library &&
        current.library.instanceId === start.library?.instanceId &&
        current.library.url === start.library.url &&
        current.library.token === start.library.token &&
        current.favoritesConsent === start.favoritesConsent &&
        current.favoritesMode === start.favoritesMode
    );
}

export function ownsSource(data: UserData, source: Source) {
    return data.sources.some(
        (current) =>
            current.id === source.id &&
            current.libraryId === source.libraryId &&
            current.provider === source.provider &&
            current.m3uItems === source.m3uItems
    );
}

export async function contextFor(
    server: ServerFavorites,
    data: UserData,
    source: Source,
    signal: AbortSignal
) {
    const context = await server.context(source.libraryId!, signal);
    if (context.provider !== source.provider)
        throw new FavoritesError(
            'Refresh the server sources to continue.',
            'source_changed'
        );
    if (
        context.sourceIncarnation !==
        data.sharedFavoriteContexts[context.sourceId]?.sourceIncarnation
    )
        await server.verifySource(source, signal);
    return context;
}

export async function retireContext(
    repo: UserDataRepository,
    start: UserData,
    sourceId: string,
    signal: AbortSignal
) {
    await repo.update((current) => {
        if (signal.aborted || !ownsLibrary(current, start)) return current;
        const sharedFavoriteContexts = {
            ...current.sharedFavoriteContexts,
        };
        delete sharedFavoriteContexts[sourceId];
        return { ...current, sharedFavoriteContexts };
    });
}

export async function refreshSources(
    repo: UserDataRepository,
    server: ServerFavorites,
    start: UserData,
    signal: AbortSignal
) {
    const transport = start.backend
        ? new ProviderTransport(start.backend, start.backendToken)
        : undefined;
    let unresolved = 0;
    for (const source of start.sources) {
        if (signal.aborted || !ownsLibrary(repo.data, start)) break;
        if (!source.libraryId || !ownsSource(repo.data, source)) continue;

        const sourceId = source.libraryId;
        let context: FavoriteSourceContext;
        let entries: Awaited<ReturnType<ServerFavorites['listAll']>>;
        try {
            context = await contextFor(server, repo.data, source, signal);
            entries = await server.listAll(sourceId, signal);
            const latest = await server.context(sourceId, signal);
            if (latest.sourceIncarnation !== context.sourceIncarnation) {
                await retireContext(repo, start, sourceId, signal);
                continue;
            }
        } catch (failure) {
            if (!(failure instanceof FavoritesError && failure.sourceRetired))
                throw failure;
            await retireContext(repo, start, sourceId, signal);
            continue;
        }

        const media = await resolveFavoriteEntries(
            source,
            entries,
            transport,
            signal
        ).catch((failure: unknown) => {
            if (source.provider !== 'm3u' || signal.aborted) throw failure;
            return new Map<string, Media>();
        });
        unresolved += entries.filter(
            ({ address, state }) =>
                state.member && !media.has(favoriteAddressKey(address))
        ).length;
        await repo.update((current) =>
            !signal.aborted &&
            ownsLibrary(current, start) &&
            ownsSource(current, source)
                ? mergeFavoriteSource(current, source, context, entries, media)
                : current
        );
    }
    return unresolved;
}

export async function deliver(
    repo: UserDataRepository,
    server: ServerFavorites,
    start: UserData,
    signal: AbortSignal
) {
    while (!signal.aborted && ownsLibrary(repo.data, start)) {
        const next = pendingFavorites(repo.data)[0];
        if (!next) return;
        const head = next.entry.record.pending[0];
        try {
            const result = await server.apply(
                head.address,
                head.operation,
                signal
            );
            await repo.update((current) =>
                !signal.aborted && ownsLibrary(current, start)
                    ? commitFavoriteResult(
                          current,
                          next.key,
                          head.operation.operationId,
                          result
                      ).data
                    : current
            );
        } catch (failure) {
            if (!(failure instanceof FavoritesError && failure.sourceRetired))
                throw failure;
            await retireContext(repo, start, head.address.sourceId, signal);
        }
    }
}
