import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createStalkerMockApp } from './app.js';

interface HttpResult {
    status: number;
    body: unknown;
}

async function request(
    server: http.Server,
    path: string,
    options: { method?: string; headers?: Record<string, string> } = {}
): Promise<HttpResult> {
    const address = server.address() as AddressInfo;

    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                port: address.port,
                path,
                method: options.method ?? 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    resolve({
                        status: res.statusCode ?? 0,
                        body: raw.length > 0 ? JSON.parse(raw) : undefined,
                    });
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

describe('createStalkerMockApp', () => {
    let server: http.Server;
    let consoleLog: jest.SpyInstance;

    beforeEach(async () => {
        consoleLog = jest.spyOn(console, 'log').mockImplementation();
        server = http.createServer(
            createStalkerMockApp({
                now: () => new Date('2026-07-27T10:00:00.000Z'),
                log: () => undefined,
            })
        );
        await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve)
        );
    });

    afterEach(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
        );
        consoleLog.mockRestore();
    });

    it('serves the existing direct portal catalog endpoint', async () => {
        const result = await request(
            server,
            '/portal.php?type=stb&action=handshake',
            { headers: { cookie: 'mac=00:1a:79:00:00:01' } }
        );

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            js: expect.objectContaining({ token: expect.any(String) }),
        });
    });

    it('preserves MAC-selected catalog scenarios', async () => {
        const result = await request(
            server,
            '/portal.php?type=itv&action=get_categories',
            { headers: { cookie: 'mac=00:1a:79:00:00:03' } }
        );

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            js: [
                expect.objectContaining({ id: '1001' }),
                expect.objectContaining({ id: '1002' }),
                expect.objectContaining({
                    id: '1099',
                    censored: '1',
                }),
            ],
        });
    });

    it('serves the existing PWA proxy endpoint', async () => {
        const result = await request(
            server,
            '/stalker?url=http%3A%2F%2Fportal.invalid&type=stb&action=handshake&macAddress=00%3A1a%3A79%3A00%3A00%3A01'
        );

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            payload: {
                js: expect.objectContaining({ token: expect.any(String) }),
            },
        });
    });

    it('keeps health and reset lifecycle routes available', async () => {
        await expect(request(server, '/health')).resolves.toEqual({
            status: 200,
            body: {
                status: 'ok',
                timestamp: '2026-07-27T10:00:00.000Z',
            },
        });
        await expect(
            request(server, '/reset', { method: 'POST' })
        ).resolves.toEqual({
            status: 200,
            body: {
                status: 'reset',
                timestamp: '2026-07-27T10:00:00.000Z',
            },
        });
    });
});
