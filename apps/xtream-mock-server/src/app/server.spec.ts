import { connect } from 'node:net';
import { resetAll } from './data-store.js';
import {
    createXtreamMockApp,
    parseXtreamMockServerEnvironment,
} from './server.js';
import { startLoopbackServer } from './testing/http-server.fixture.js';

jest.mock('@faker-js/faker', () => {
    const fixedDate = new Date('2020-01-01T00:00:00.000Z');
    const fixedText = 'Fixture value';
    return {
        faker: {
            seed: jest.fn(),
            company: {
                catchPhrase: () => fixedText,
                name: () => fixedText,
            },
            date: {
                past: () => fixedDate,
                recent: () => fixedDate,
            },
            location: { country: () => fixedText },
            lorem: {
                paragraph: () => fixedText,
                sentence: () => fixedText,
                words: () => fixedText,
            },
            music: {
                genre: () => fixedText,
                songName: () => fixedText,
            },
            number: {
                int: ({ min = 0 }: { min?: number }) => min,
            },
            person: { fullName: () => fixedText },
        },
    };
});

jest.setTimeout(60_000);

describe('Xtream mock server factory', () => {
    afterEach(() => {
        resetAll();
        jest.restoreAllMocks();
    });

    it('keeps performance controls absent unless explicitly enabled', async () => {
        const running = await startLoopbackServer(
            createXtreamMockApp({ host: '127.0.0.1', port: 0 })
        );
        try {
            const response = await fetch(`${running.origin}/__control/state`);
            expect(response.status).toBe(404);
        } finally {
            await running.close();
        }
    });

    it('reports the configured port and preserves direct/PWA responses', async () => {
        const running = await startLoopbackServer(
            createXtreamMockApp({ host: '127.0.0.1', port: 0 })
        );
        try {
            const health = await fetch(`${running.origin}/health`).then((r) =>
                r.json()
            );
            const direct = await fetch(
                `${running.origin}/player_api.php?username=performance&password=performance&action=get_live_categories`
            );
            const directBody = await direct.json();
            const proxy = await fetch(
                `${running.origin}/xtream?url=http%3A%2F%2Fignored.invalid&username=performance&password=performance&action=get_live_categories`
            );
            const proxyBody = await proxy.json();

            expect(health).toEqual({
                status: 'ok',
                server: 'xtream-mock-server',
                port: 0,
            });
            expect(direct.status).toBe(200);
            expect(directBody).toHaveLength(60);
            expect(proxy.status).toBe(200);
            expect(proxyBody).toEqual({
                payload: directBody,
                action: 'get_live_categories',
            });
        } finally {
            await running.close();
        }
    });

    it('preserves the basic M3U fixture and ordinary stream redirects', async () => {
        const running = await startLoopbackServer(
            createXtreamMockApp({ host: '127.0.0.1', port: 0 })
        );
        try {
            const playlist = await fetch(`${running.origin}/playlist.m3u`);
            const stream = await fetch(
                `${running.origin}/live/user1/pass1/10000.m3u8`,
                { redirect: 'manual' }
            );

            expect(playlist.status).toBe(200);
            expect(playlist.headers.get('content-type')).toContain(
                'audio/x-mpegurl'
            );
            expect(await playlist.text()).toContain('#EXTM3U');
            expect(stream.status).toBe(302);
            expect(stream.headers.get('location')).toBe(
                'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
            );
        } finally {
            await running.close();
        }
    });

    it('keeps a non-EPG timezone stream empty across repeated short-EPG requests', async () => {
        const running = await startLoopbackServer(
            createXtreamMockApp({ host: '127.0.0.1', port: 0 })
        );
        const requestUrl = `${running.origin}/player_api.php?username=epg&password=epg&action=get_short_epg&stream_id=10001`;
        try {
            const firstResponse = await fetch(requestUrl).then((response) =>
                response.json()
            );
            const secondResponse = await fetch(requestUrl).then((response) =>
                response.json()
            );

            expect(firstResponse.epg_listings).toHaveLength(0);
            expect(secondResponse.epg_listings).toHaveLength(0);
        } finally {
            await running.close();
        }
    });

    it('rejects non-loopback performance binds before opening a listener', () => {
        expect(() =>
            createXtreamMockApp({
                control: { enabled: true, token: 'test-token' },
                host: '0.0.0.0',
                port: 0,
            })
        ).toThrow(/loopback/i);
    });

    it('makes local-only performance media routes terminal without outbound requests', async () => {
        const running = await startLoopbackServer(
            createXtreamMockApp({
                control: { enabled: true, token: 'test-token' },
                host: '127.0.0.1',
                port: 0,
            })
        );
        try {
            const httpModule =
                jest.requireActual<typeof import('node:http')>('node:http');
            const httpsModule =
                jest.requireActual<typeof import('node:https')>('node:https');
            const httpRequest = jest.spyOn(httpModule, 'request');
            const httpsRequest = jest.spyOn(httpsModule, 'request');
            const globalFetch = jest.spyOn(globalThis, 'fetch');
            const mediaResponses = await Promise.all(
                [
                    '/playlist.m3u',
                    '/live/performance/performance/1000000.m3u8',
                    '/live/performance/performance/1000000.ts',
                    '/movie/performance/performance/2000000.mkv',
                    '/series/performance/performance/3000000.mkv',
                    '/timeshift/performance/performance/60/start/1000000.ts',
                    '/streaming/timeshift.php?username=performance&password=performance',
                ].map((path) => rawLoopbackGet(running.origin, path))
            );

            expect(mediaResponses.map(({ status }) => status)).toEqual(
                Array(mediaResponses.length).fill(410)
            );
            expect(
                mediaResponses.every(
                    ({ headers }) => !headers.includes('location:')
                )
            ).toBe(true);
            expect(httpRequest).not.toHaveBeenCalled();
            expect(httpsRequest).not.toHaveBeenCalled();
            expect(globalFetch).not.toHaveBeenCalled();
        } finally {
            await running.close();
        }
    });
});

describe('Xtream mock environment parsing', () => {
    it('uses safe defaults and enables control only for the exact flag', () => {
        expect(parseXtreamMockServerEnvironment({})).toEqual({
            host: '0.0.0.0',
            port: 3211,
        });
        expect(
            parseXtreamMockServerEnvironment({
                IPTVNATOR_XTREAM_MOCK_CONTROL: '1',
                IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: 'secret-token',
            })
        ).toEqual({
            control: { enabled: true, token: 'secret-token' },
            host: '127.0.0.1',
            port: 3211,
        });
        expect(
            parseXtreamMockServerEnvironment({
                HOST: '::1',
                PORT: '4321',
                IPTVNATOR_XTREAM_MOCK_CONTROL: '1',
                IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: 'secret-token',
            })
        ).toEqual({
            control: { enabled: true, token: 'secret-token' },
            host: '::1',
            port: 4321,
        });
        expect(
            parseXtreamMockServerEnvironment({
                IPTVNATOR_XTREAM_MOCK_CONTROL: 'true',
                IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: 'ignored',
            })
        ).toEqual({ host: '0.0.0.0', port: 3211 });
    });

    it.each([
        [{ PORT: '-1' }, /port/i],
        [{ PORT: '12x' }, /port/i],
        [{ PORT: '65536' }, /port/i],
        [{ IPTVNATOR_XTREAM_MOCK_CONTROL: '1' }, /token/i],
        [
            {
                HOST: '192.0.2.1',
                IPTVNATOR_XTREAM_MOCK_CONTROL: '1',
                IPTVNATOR_XTREAM_MOCK_CONTROL_TOKEN: 'secret-token',
            },
            /loopback/i,
        ],
    ])('rejects invalid environment %#', (environment, message) => {
        expect(() => parseXtreamMockServerEnvironment(environment)).toThrow(
            message
        );
    });
});

async function rawLoopbackGet(
    origin: string,
    path: string
): Promise<{ headers: string; status: number }> {
    const url = new URL(origin);
    return new Promise((resolve, reject) => {
        const socket = connect(Number(url.port), url.hostname);
        let raw = '';
        socket.setEncoding('utf8');
        socket.once('error', reject);
        socket.on('data', (chunk) => (raw += chunk));
        socket.once('end', () => {
            const [headers = ''] = raw.split('\r\n\r\n');
            const status = Number(headers.split(' ')[1]);
            resolve({ headers: headers.toLowerCase(), status });
        });
        socket.once('connect', () => {
            socket.write(
                `GET ${path} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`
            );
        });
    });
}
