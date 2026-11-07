import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { handleApi } from '../devserver/server.mjs';

async function registerTarget(base, url) {
    const response = await fetch(base + '/provider-targets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).targetId;
}

test('provider routes preserve JSON payloads and send Xtream User-Agent as a header', async () => {
    const observed = [];
    const provider = createServer((req, res) => {
        observed.push({ url: new URL(req.url, 'http://synthetic.example'), headers: req.headers });
        const action = observed.at(-1).url.searchParams.get('action');
        res.end(action === 'plain' ? 'synthetic error' : '\ufeff{"synthetic":true}');
    });
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const allowed = new URL(`http://127.0.0.1:${provider.address().port}`);
    const proxy = createServer((req, res) => handleApi(req, res, new URL(req.url, 'http://127.0.0.1'), [allowed]));
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${proxy.address().port}/api`;
        const targetId = await registerTarget(base, `http://127.0.0.1:${provider.address().port}`);
        const request = (route, params) => fetch(`${base}/${route}?${new URLSearchParams({ targetId, ...params })}`).then((res) => res.json());
        for (const userAgent of [' synthetic-agent ', '   ']) {
            const result = await request('xtream', { action: 'get_vod_categories', username: 'synthetic-user', userAgent });
            assert.deepEqual(result.payload, { synthetic: true });
            assert.equal(observed.at(-1).url.searchParams.has('userAgent'), false);
            assert.equal(observed.at(-1).url.searchParams.get('username'), 'synthetic-user');
            if (userAgent.trim()) assert.equal(observed.at(-1).headers['user-agent'], userAgent.trim());
            else assert.notEqual(observed.at(-1).headers['user-agent'], '');
        }
        const handshake = await request('stalker', { action: 'handshake' });
        assert.deepEqual(handshake.payload, { synthetic: true });
        for (const route of ['xtream', 'stalker']) {
            assert.equal((await request(route, { action: 'plain' })).payload, 'synthetic error');
        }
    } finally {
        await Promise.all([proxy, provider].map((server) => new Promise((resolve) => server.close(resolve))));
    }
});

test('only an initial connection refusal permits HTTP discovery', { timeout: 3000 }, async () => {
    const unavailable = createServer();
    await new Promise((resolve) => unavailable.listen(0, '127.0.0.1', resolve));
    const refused = `http://127.0.0.1:${unavailable.address().port}`;
    await new Promise((resolve) => unavailable.close(resolve));

    const provider = createServer((_req, res) => res.writeHead(302, { Location: refused }).end());
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const allowed = `http://127.0.0.1:${provider.address().port}`;
    const allowedOrigins = [new URL(allowed), new URL(refused)];
    const proxy = createServer((req, res) => handleApi(req, res, new URL(req.url, 'http://127.0.0.1'), allowedOrigins));
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${proxy.address().port}/api`;
        for (const [url, canTryHttp] of [[refused, true], [allowed, false]]) {
            const targetId = await registerTarget(base, url);
            const result = await fetch(`${base}/xtream?targetId=${targetId}&connectionTest=true`).then((res) => res.json());
            assert.deepEqual(result, { connectionFailure: { kind: 'connection', canTryHttp } });
        }
    } finally {
        await Promise.all([proxy, provider].map((server) => new Promise((resolve) => server.close(resolve))));
    }
});

test('provider registration and redirects cannot reach an unapproved origin', async () => {
    let deniedRequests = 0;
    const denied = createServer((_req, res) => {
        deniedRequests++;
        res.end('synthetic private response');
    });
    const provider = createServer((_req, res) => {
        res.writeHead(302, { Location: `http://127.0.0.1:${denied.address().port}/synthetic` }).end();
    });
    for (const server of [denied, provider]) await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const allowed = new URL(`http://127.0.0.1:${provider.address().port}`);
    const proxy = createServer((req, res) => handleApi(req, res, new URL(req.url, 'http://127.0.0.1'), [allowed]));
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${proxy.address().port}/api`;
        const blocked = await fetch(base + '/provider-targets', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `http://127.0.0.1:${denied.address().port}` }),
        });
        assert.equal(blocked.status, 403);
        const targetId = await registerTarget(base, allowed.href);
        const redirected = await fetch(`${base}/xtream?targetId=${targetId}`).then((res) => res.json());
        assert.equal(redirected.code, 'ERR_PROVIDER_ORIGIN');
        assert.equal(deniedRequests, 0);
    } finally {
        await Promise.all([proxy, provider, denied].map((server) => new Promise((resolve) => server.close(resolve))));
    }
});
