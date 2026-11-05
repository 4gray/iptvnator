import type { Playlist } from '@iptvnator/shared/interfaces';
import type { Source, LibrarySettings } from '@iptvnator/tv/util';
import { backendUrl } from './backend';
import {
    librarySource,
    sameLibrarySource,
    sourceDocument,
} from './library-sources';

export class LibraryError extends Error {}
export class ServerLibrary {
    readonly url: string;
    constructor(
        url: string,
        private token: string,
        private expectedInstance = ''
    ) {
        try {
            this.url = backendUrl(url);
        } catch {
            throw new LibraryError(
                'Enter a valid HTTP or HTTPS library URL without embedded credentials.'
            );
        }
    }
    private async request(
        path: string,
        signal: AbortSignal,
        init: RequestInit = {},
        publicRequest = false
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
                    ...(!publicRequest && this.token
                        ? { Authorization: `Bearer ${this.token}` }
                        : {}),
                    ...init.headers,
                },
            });
            if (!response.ok)
                throw new LibraryError(
                    response.status === 401
                        ? 'Server access denied. Check the library access token.'
                        : response.status === 412
                          ? 'This source already exists. Refresh the library before trying again.'
                          : 'The server library request failed. Your saved library is unchanged.'
                );
            return await response.json();
        } catch (error) {
            if (error instanceof LibraryError) throw error;
            throw new LibraryError(
                'Server library unavailable. Check its address, network and allowed TV origin. Saved sources remain available.'
            );
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
        }
    }
    async identify(signal: AbortSignal): Promise<string> {
        // Never send a saved token or write before verifying the public instance identity.
        const info = await this.request('/instance', signal, {}, true);
        if (
            info?.service !== 'iptvnator' ||
            info.apiVersion !== 1 ||
            info.storage !== 'server' ||
            typeof info.instanceId !== 'string' ||
            !info.instanceId ||
            !['none', 'token'].includes(info.auth)
        )
            throw new LibraryError(
                'This server does not offer a compatible shared library.'
            );
        if (this.expectedInstance && info.instanceId !== this.expectedInstance)
            throw new LibraryError(
                'The server library has changed. Connect again to confirm the new library.'
            );
        this.expectedInstance = info.instanceId;
        return info.instanceId;
    }
    async read(
        signal: AbortSignal
    ): Promise<{ settings: LibrarySettings; sources: Source[] }> {
        const instanceId = await this.identify(signal);
        const documents: unknown = await this.request(
            '/playlists?view=meta',
            signal
        );
        if (!Array.isArray(documents))
            throw new LibraryError(
                'Invalid server library response. Saved sources are unchanged.'
            );
        const ids = new Set<string>();
        const sources: Source[] = [];
        for (let document of documents as Playlist[]) {
            if (
                !document ||
                typeof document._id !== 'string' ||
                ids.has(document._id)
            )
                throw new LibraryError(
                    'Invalid source identities in the server library.'
                );
            ids.add(document._id);
            // File/pasted M3Us need their stored payload; URL M3Us use the provider parser.
            if (!document.serverUrl && !document.macAddress && !document.url)
                document = await this.request(
                    `/playlists/${encodeURIComponent(document._id)}`,
                    signal
                );
            try {
                sources.push(librarySource(document, instanceId));
            } catch {
                throw new LibraryError(
                    'A server source is incomplete or unsupported. Saved sources are unchanged.'
                );
            }
        }
        return {
            settings: {
                url: this.url,
                token: this.token,
                instanceId,
                lastSync: 0,
                originals: {},
            },
            sources,
        };
    }
    async upload(source: Source, signal: AbortSignal) {
        const current = await this.read(signal);
        // Existing server data wins; never overwrite a library, favorites or history.
        const match = current.sources.find(
            (s) =>
                sameLibrarySource(s, source) ||
                (s.libraryId === source.id &&
                    source.m3uItems !== undefined &&
                    JSON.stringify(s.m3uItems) ===
                        JSON.stringify(source.m3uItems))
        );
        if (!match && current.sources.some((s) => s.libraryId === source.id))
            throw new LibraryError(
                'A different server source already uses this ID. No source was overwritten.'
            );
        if (!match) {
            await this.identify(signal);
            await this.request(
                `/playlists/${encodeURIComponent(source.id)}`,
                signal,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'If-None-Match': '*',
                    },
                    body: JSON.stringify(sourceDocument(source)),
                }
            );
        }
        return this.read(signal);
    }
}
