import { ServerApiError } from './server-api-client';

/** Browser storage in memory, with the `keys` listing tabs use. */
export function memoryStorage() {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        keys: () => [...values.keys()],
    };
}

/** A server that keeps entries, tags them by content and refuses stale tags. */
export function fakeServer(
    initial: Record<string, Record<string, unknown>> = {}
) {
    const state: Record<string, Record<string, unknown>> = {
        'xtream-favorites': {},
        'xtream-recent-items': {},
        'xtream-collection-items': {},
        'xtream-playback-positions': {},
        ...structuredClone(initial),
    };
    /** Playlists deleted on the server: their user state is refused. */
    const deleted = new Set<string>();
    const tagOf = (value: unknown) =>
        value === undefined
            ? null
            : `t${JSON.stringify(value).replace(/"/g, "'")}`;
    const answer = (body: unknown) =>
        ({ json: async () => body }) as unknown as Response;
    const write = (
        path: string,
        headers: Record<string, string>,
        value?: unknown
    ) => {
        const [, , namespace, playlistId] = path.split('/');
        if (value !== undefined && deleted.has(playlistId)) {
            throw new ServerApiError(404, 'playlist_missing', 'gone');
        }
        const current = state[namespace][playlistId];
        const expected =
            headers['If-None-Match'] === '*'
                ? null
                : headers['If-Match']?.replace(/^"|"$/g, '');
        if (expected !== undefined && expected !== tagOf(current)) {
            throw new ServerApiError(412, 'conflict', 'changed', {
                ...(current === undefined ? {} : { value: current }),
                tag: tagOf(current),
            });
        }
        if (value === undefined) {
            delete state[namespace][playlistId];
        } else {
            state[namespace][playlistId] = value;
        }
        return answer({ tag: tagOf(value) });
    };
    const api = {
        getJson: jest.fn(async () => {
            const tags: Record<string, Record<string, string>> = {};
            for (const [namespace, entries] of Object.entries(state)) {
                tags[namespace] = Object.fromEntries(
                    Object.entries(entries).map(([id, value]) => [
                        id,
                        tagOf(value) as string,
                    ])
                );
            }
            return { entries: structuredClone(state), tags };
        }),
        sendJson: jest.fn(
            async (
                _method: string,
                path: string,
                body: { value: unknown },
                headers: Record<string, string> = {}
            ) => write(path, headers, body.value)
        ),
        request: jest.fn(
            async (path: string, init: { headers?: Record<string, string> }) =>
                write(path, init.headers ?? {})
        ),
        readJson: jest.fn((response: Response) => response.json()),
        sendKeepalive: jest.fn(
            async (
                _method: string,
                path: string,
                body?: { value: unknown },
                headers: Record<string, string> = {}
            ) => {
                try {
                    const response = write(path, headers, body?.value);
                    const { tag } = await response.json();
                    return { status: 'saved' as const, tag };
                } catch (error) {
                    if (
                        error instanceof ServerApiError &&
                        error.code === 'playlist_missing'
                    ) {
                        return { status: 'gone' as const };
                    }
                    return error instanceof ServerApiError && error.current
                        ? {
                              status: 'conflict' as const,
                              current: error.current,
                          }
                        : { status: 'failed' as const };
                }
            }
        ),
    };
    return { state, api, deleted };
}
