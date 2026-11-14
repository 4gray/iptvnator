import type { Playlist } from '@iptvnator/shared/interfaces';
import type { Source } from '@iptvnator/tv/util';
import { librarySource, sameLibrarySource } from './library-sources';
import {
    assertFavoriteState,
    FAVORITES_SYNC_CAPABILITY,
    type FavoriteAddress,
    type FavoriteList,
    type FavoriteOperation,
    type FavoriteResult,
    type FavoriteSourceContext,
} from '@iptvnator/shared/interfaces/favorites-sync';
import { backendUrl } from './backend';

import { FavoritesError } from './favorites-error';
export { FavoritesError };

/** `/v1/favorites` client; transport errors stay retryable, record writes stay local. */
export class ServerFavorites {
    readonly url: string;
    constructor(
        url: string,
        private token: string,
        readonly instanceId: string
    ) {
        this.url = backendUrl(url);
    }
    private async request(
        path: string,
        signal: AbortSignal,
        init: RequestInit = {}
    ) {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal.addEventListener('abort', cancel);
        if (signal.aborted) cancel();
        const timer = setTimeout(cancel, 15000);
        try {
            const response = await fetch(`${this.url}/v1${path}`, {
                ...init,
                signal: controller.signal,
                cache: 'no-store',
                redirect: 'error',
                headers: {
                    ...(path !== '/instance' && this.token
                        ? { Authorization: `Bearer ${this.token}` }
                        : {}),
                    ...(path !== '/instance'
                        ? { 'x-iptvnator-instance-id': this.instanceId }
                        : {}),
                    ...init.headers,
                },
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new FavoritesError(
                    response.status === 401
                        ? 'Server access denied. Check the library access token.'
                        : 'The shared favorites request failed.',
                    typeof body?.code === 'string' ? body.code : undefined,
                    response.status >= 500
                );
            }
            return await response.json().catch(() => {
                throw new FavoritesError('Invalid shared favorites response.');
            });
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
        }
    }

    async verify(signal: AbortSignal) {
        const info = await this.request('/instance', signal);
        if (
            info?.service !== 'iptvnator' ||
            info.apiVersion !== 1 ||
            info.storage !== 'server' ||
            info.instanceId !== this.instanceId
        )
            throw new FavoritesError(
                'The server library has changed. Reconnect to continue.'
            );
        if (
            !Array.isArray(info.capabilities) ||
            !info.capabilities.includes(FAVORITES_SYNC_CAPABILITY)
        )
            throw new FavoritesError('Update the server to share favorites.');
    }

    async context(sourceId: string, signal: AbortSignal) {
        const context = (await this.request(
            `/favorites/sources/${encodeURIComponent(sourceId)}`,
            signal
        )) as FavoriteSourceContext;
        if (
            context?.sourceId !== sourceId ||
            typeof context.sourceIncarnation !== 'string' ||
            !context.sourceIncarnation ||
            !['m3u', 'xtream', 'stalker'].includes(context.provider)
        )
            throw new FavoritesError('Invalid shared favorite source.');
        return context;
    }
    async verifySource(source: Source, signal: AbortSignal) {
        const document = (await this.request(
            `/playlists/${encodeURIComponent(source.libraryId!)}`,
            signal
        )) as Playlist;
        const remote = librarySource(document, this.instanceId);
        const same =
            source.m3uItems && remote.m3uItems
                ? JSON.stringify(source.m3uItems) ===
                  JSON.stringify(remote.m3uItems)
                : sameLibrarySource({ ...source, endpoint: undefined }, remote);
        if (!same || remote.libraryId !== source.libraryId)
            throw new FavoritesError(
                'Refresh the server sources to continue.',
                'source_changed'
            );
    }

    async list(sourceId: string, signal: AbortSignal, cursor?: string) {
        const page = (await this.request(
            `/favorites/sources/${encodeURIComponent(sourceId)}/items${
                cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
            }`,
            signal
        )) as FavoriteList;
        if (
            !Array.isArray(page?.entries) ||
            (page.cursor !== undefined &&
                (typeof page.cursor !== 'string' ||
                    !page.cursor ||
                    page.cursor === cursor))
        )
            throw new FavoritesError('Invalid shared favorite list.');
        return page;
    }
    async listAll(sourceId: string, signal: AbortSignal) {
        const entries: FavoriteList['entries'] = [];
        const seen = new Set<string>();
        let cursor: string | undefined;
        do {
            const page = await this.list(sourceId, signal, cursor);
            entries.push(...page.entries);
            cursor = page.cursor;
            if (cursor && seen.has(cursor))
                throw new FavoritesError('Invalid shared favorite cursor.');
            if (cursor) seen.add(cursor);
        } while (cursor);
        return entries;
    }

    async apply(
        address: FavoriteAddress,
        operation: FavoriteOperation,
        signal: AbortSignal
    ) {
        const result = (await this.request(`/favorites/operations`, signal, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, operation }),
        })) as FavoriteResult;
        assertFavoriteState(result.state);
        if (!['applied', 'conflict'].includes(result.status))
            throw new FavoritesError('Invalid shared favorite receipt.');
        return result;
    }
}
