import { once } from 'node:events';
import { createServer } from 'node:http';
import {
    fetchTestServer,
    requestTestServer,
    serverOrigin,
} from './http-server.spec-helpers';

describe('HTTP test transport', () => {
    afterEach(() => jest.restoreAllMocks());

    it('preserves request data, status, headers, and empty responses over the in-memory transport', async () => {
        jest.replaceProperty(process, 'env', {
            ...process.env,
            IPTVNATOR_TEST_HTTP_TRANSPORT: 'memory',
        });
        const server = createServer(async (req, res) => {
            if (req.method === 'DELETE') {
                res.writeHead(204).end();
                return;
            }
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk);
            res.setHeader('content-type', 'application/json');
            res.writeHead(201).end(
                JSON.stringify({
                    input: Buffer.concat(chunks).toString(),
                    method: req.method,
                    path: req.url,
                    marker: req.headers['x-synthetic-marker'],
                })
            );
        });
        await once(server.listen(0, '127.0.0.1'), 'listening');
        const url = serverOrigin(server);
        const fetch = fetchTestServer(server);
        try {
            const response = await fetch(`${url}/fixture?test=1`, {
                method: 'POST',
                body: 'synthetic body',
                headers: { 'x-synthetic-marker': 'test' },
            });
            expect(response.status).toBe(201);
            expect(response.headers.get('content-type')).toBe(
                'application/json'
            );
            expect(await response.json()).toEqual({
                input: 'synthetic body',
                method: 'POST',
                path: '/fixture?test=1',
                marker: 'test',
            });
            const empty = await fetch(`${url}/fixture`, { method: 'DELETE' });
            expect(empty.status).toBe(204);
            expect(await empty.text()).toBe('');
            await expect(
                fetch('http://other.example.test/fixture')
            ).rejects.toThrow('does not belong');
        } finally {
            const closed = once(server, 'close');
            server.close();
            await closed;
        }
        expect(() => requestTestServer(server, url, {}, jest.fn())).toThrow(
            'Test server is closed'
        );
    });
});
