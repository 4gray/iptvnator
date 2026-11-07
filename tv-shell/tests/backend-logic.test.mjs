import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { fetchText } from '../devserver/backend-logic.mjs';

test('redirects retain identity on the same origin and drop it across origins', async () => {
    const observed = [];
    const destination = createServer((req, res) => {
        observed.push(req.headers);
        res.end('synthetic response');
    });
    const source = createServer((req, res) => {
        if (req.url === '/same') res.writeHead(302, { Location: '/target' }).end();
        else if (req.url === '/cross') res.writeHead(302, { Location: `http://127.0.0.1:${destination.address().port}/target` }).end();
        else { observed.push(req.headers); res.end('synthetic response'); }
    });
    for (const server of [destination, source]) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const headers = { aUtHoRiZaTiOn: 'Bearer synthetic-token', Cookie: 'mac=synthetic-mac', SN: 'synthetic-serial', 'Proxy-Authorization': 'synthetic-proxy', Host: 'synthetic-source.example', 'User-Agent': 'synthetic-agent' };
        const base = `http://127.0.0.1:${source.address().port}`;
        const allowedOrigins = [new URL(base), new URL(`http://127.0.0.1:${destination.address().port}`)];
        await fetchText(base + '/same', allowedOrigins, { headers });
        await fetchText(base + '/cross', allowedOrigins, { headers });
        assert.equal(observed[0].authorization, headers.aUtHoRiZaTiOn);
        assert.equal(observed[0].cookie, headers.Cookie);
        assert.equal(observed[0].sn, headers.SN);
        assert.equal(observed[0]['proxy-authorization'], headers['Proxy-Authorization']);
        assert.equal(observed[0].host, headers.Host);
        for (const key of ['authorization', 'cookie', 'proxy-authorization', 'sn']) assert.equal(observed[1][key], undefined);
        assert.notEqual(observed[1].host, headers.Host);
        assert.equal(observed[1]['user-agent'], headers['User-Agent']);
        assert.equal(headers.Cookie, 'mac=synthetic-mac');
    } finally {
        await Promise.all([source, destination].map((server) => new Promise((resolve) => server.close(resolve))));
    }
});

test('malformed redirect locations reject without an uncaught exception', { timeout: 3000 }, async () => {
    const provider = createServer((_req, res) => res.writeHead(302, { Location: 'http://[' }).end());
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    try {
        const origin = new URL(`http://127.0.0.1:${provider.address().port}`);
        await assert.rejects(fetchText(origin.href, [origin]), { code: 'ERR_INVALID_URL' });
    } finally {
        await new Promise((resolve) => provider.close(resolve));
    }
});

test('a compressed response rejects when its upstream socket closes early', { timeout: 3000 }, async () => {
    const payload = '\ufeff{"synthetic":true}';
    const compressed = gzipSync(payload);
    const provider = createServer((req, res) => {
        res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': compressed.length });
        if (req.url === '/complete') return res.end(compressed);
        res.write(compressed.subarray(0, 15));
        res.socket.end();
    });
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${provider.address().port}`;
        const allowedOrigins = [new URL(base)];
        assert.equal(await fetchText(base + '/complete', allowedOrigins), payload);
        await assert.rejects(fetchText(base + '/truncated', allowedOrigins, { timeoutMs: 1000 }), { code: 'ECONNRESET' });
    } finally {
        await new Promise((resolve) => provider.close(resolve));
    }
});

test('an inherited origin does not authorize a non-HTTP URL', async () => {
    const provider = createServer((_req, res) => res.end('synthetic response'));
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    try {
        const origin = new URL(`http://127.0.0.1:${provider.address().port}`);
        await assert.rejects(fetchText(`blob:${origin.href}synthetic`, [origin]), { code: 'ERR_PROVIDER_ORIGIN' });
    } finally {
        await new Promise((resolve) => provider.close(resolve));
    }
});
