import { SERVER_ACCESS_TOKEN_STORAGE_KEY } from '../server-access-token';
import { ServerApiClient, ServerApiError } from './server-api-client';

// jsdom has Headers but no Response or fetch.
function response(status: number, body?: unknown) {
    return {
        status,
        ok: status >= 200 && status < 300,
        statusText: '',
        headers: new Headers(),
        json: async () => body,
    } as unknown as Response;
}

describe('ServerApiClient', () => {
    const status = {
        reportSuccess: jest.fn(),
        reportOffline: jest.fn(),
        reportUnauthorized: jest.fn(),
    };
    const onWriteFailure = jest.fn();

    afterEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
    });

    function client(fetchFn: jest.Mock) {
        return new ServerApiClient({
            baseUrl: '/api/',
            status,
            onWriteFailure,
            fetchFn: fetchFn as unknown as typeof fetch,
        });
    }

    it('calls /v1 with the token and reports success', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 't');
        const fetchFn = jest
            .fn()
            .mockResolvedValue(response(200, { ok: true }));

        await expect(client(fetchFn).getJson('/instance')).resolves.toEqual({
            ok: true,
        });

        const [url, init] = fetchFn.mock.calls[0];
        expect(url).toBe('/api/v1/instance');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer t' });
        expect(status.reportSuccess).toHaveBeenCalled();
    });

    it('reports offline on a network error and announces failed writes', async () => {
        const fetchFn = jest
            .fn()
            .mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(
            client(fetchFn).sendJson('PUT', '/playlists/a', {})
        ).rejects.toMatchObject({ status: 0, code: 'network' });
        expect(status.reportOffline).toHaveBeenCalled();
        expect(onWriteFailure).toHaveBeenCalledTimes(1);
    });

    it('reports offline when a proxy answers for a down backend', async () => {
        for (const code of [502, 503, 504]) {
            const fetchFn = jest
                .fn()
                .mockResolvedValue(response(code, 'Bad Gateway'));

            await expect(
                client(fetchFn).getJson('/user-state')
            ).rejects.toMatchObject({ status: code });
        }
        expect(status.reportOffline).toHaveBeenCalledTimes(3);

        // A backend error is not an outage.
        status.reportOffline.mockClear();
        await expect(
            client(
                jest.fn().mockResolvedValue(response(500, { code: 'x' }))
            ).getJson('/user-state')
        ).rejects.toMatchObject({ status: 500 });
        expect(status.reportOffline).not.toHaveBeenCalled();
    });

    it('reports how a keepalive write ended', async () => {
        const ok = jest.fn().mockResolvedValue(response(200, { tag: 't2' }));
        await expect(
            client(ok).sendKeepalive('PUT', '/user-state/a/b', { value: 1 })
        ).resolves.toEqual({ status: 'saved', tag: 't2' });
        expect(ok.mock.calls[0][1]).toMatchObject({ keepalive: true });

        const conflict = jest.fn().mockResolvedValue(
            response(412, {
                code: 'conflict',
                message: 'changed',
                current: { value: [2], tag: 't3' },
            })
        );
        await expect(
            client(conflict).sendKeepalive('PUT', '/user-state/a/b', {
                value: 1,
            })
        ).resolves.toEqual({
            status: 'conflict',
            current: { value: [2], tag: 't3' },
        });

        const gone = jest
            .fn()
            .mockResolvedValue(
                response(404, { code: 'playlist_missing', message: 'gone' })
            );
        await expect(
            client(gone).sendKeepalive('PUT', '/user-state/a/b', { value: 1 })
        ).resolves.toEqual({ status: 'gone' });

        const refused = jest
            .fn()
            .mockRejectedValue(new TypeError('body too large'));
        await expect(
            client(refused).sendKeepalive('DELETE', '/user-state/a/b')
        ).resolves.toEqual({ status: 'failed' });
    });

    it('holds writes, not reads, until the instance is checked', async () => {
        const fetchFn = jest.fn().mockResolvedValue(response(200, {}));
        const held = new ServerApiClient({
            baseUrl: '/api',
            status,
            fetchFn: fetchFn as unknown as typeof fetch,
            holdWrites: true,
        });

        await expect(
            held.sendJson('PUT', '/user-state/a/b', { value: 1 })
        ).rejects.toMatchObject({ status: 0, code: 'network' });
        await expect(
            held.sendKeepalive('DELETE', '/user-state/a/b')
        ).resolves.toEqual({ status: 'failed' });
        await held.getJson('/instance');

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn.mock.calls[0][0]).toBe('/api/v1/instance');
    });

    it('reports offline when a body is cut off after the headers', async () => {
        const cut = {
            ...response(200),
            json: async () => {
                throw new TypeError('network error');
            },
        } as unknown as Response;

        await expect(
            client(jest.fn().mockResolvedValue(cut)).getJson('/user-state')
        ).rejects.toMatchObject({ status: 0, code: 'network' });
        expect(status.reportOffline).toHaveBeenCalled();

        // Malformed JSON is an answer, not an outage.
        status.reportOffline.mockClear();
        const malformed = {
            ...response(200),
            json: async () => {
                throw new SyntaxError('Unexpected token');
            },
        } as unknown as Response;
        await expect(
            client(jest.fn().mockResolvedValue(malformed)).getJson('/x')
        ).rejects.toBeInstanceOf(SyntaxError);
        expect(status.reportOffline).not.toHaveBeenCalled();
    });

    it('clears the token and reports unauthorized on 401', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 'old');
        const fetchFn = jest
            .fn()
            .mockResolvedValue(response(401, { code: 'unauthorized' }));

        await expect(
            client(fetchFn).getJson('/playlists')
        ).rejects.toBeInstanceOf(ServerApiError);
        expect(
            localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
        ).toBeNull();
        expect(status.reportUnauthorized).toHaveBeenCalled();
    });

    it('keeps a token stored while a request with the old one ran', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 'old');
        const fetchFn = jest.fn(async () => {
            // The user signs in again before the old request is answered.
            localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 'new');
            return response(401, { code: 'unauthorized' });
        });

        await expect(
            client(fetchFn).getJson('/playlists')
        ).rejects.toBeInstanceOf(ServerApiError);
        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe(
            'new'
        );
        expect(status.reportUnauthorized).not.toHaveBeenCalled();
    });

    it('sends no token to an instance not checked yet and keeps it on a 401', async () => {
        localStorage.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, 'kept');
        const fetchFn = jest
            .fn()
            .mockResolvedValue(response(401, { code: 'unauthorized' }));
        const unchecked = new ServerApiClient({
            baseUrl: '/api',
            status,
            fetchFn: fetchFn as unknown as typeof fetch,
            accessToken: () => null,
        });

        await expect(unchecked.getJson('/instance')).rejects.toBeInstanceOf(
            ServerApiError
        );

        expect(fetchFn.mock.calls[0][1].headers).not.toHaveProperty(
            'Authorization'
        );
        expect(localStorage.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)).toBe(
            'kept'
        );
        expect(status.reportUnauthorized).not.toHaveBeenCalled();
    });

    it('passes 304 through and maps error bodies', async () => {
        const fetchFn = jest
            .fn()
            .mockResolvedValueOnce(response(304))
            .mockResolvedValueOnce(
                response(409, { message: 'x', code: 'payload_missing' })
            );
        const api = client(fetchFn);

        expect((await api.request('/playlists/a')).status).toBe(304);
        await expect(
            api.sendJson('PUT', '/playlists/a', {})
        ).rejects.toMatchObject({
            status: 409,
            code: 'payload_missing',
        });
        expect(onWriteFailure).not.toHaveBeenCalled();
    });
});
