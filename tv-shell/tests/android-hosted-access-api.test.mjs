import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const bootstrap = readFileSync(new URL(
    '../android/app/src/main/assets/tvshell/hosted-access-api.js', import.meta.url
), 'utf8');
const origin = 'http://synthetic.iptvnator.localhost';

function connect(onRequest, directFetch = fetch) {
    const bridge = {
        postMessage(data) {
            const request = JSON.parse(data);
            queueMicrotask(() => onRequest(request, result => {
                bridge.onmessage({ data: JSON.stringify({ id: request.id, ...result }) });
            }));
        },
    };
    const window = { HostedAccessApi: bridge, fetch: directFetch };
    runInNewContext(bootstrap, {
        window,
        location: new URL(origin),
        URL, Request, Response, ReadableStream, Uint8Array, DOMException, atob, btoa,
    });
    return window.fetch;
}

test('HTTP manifests and segments use the browser transport without hosted credentials', async () => {
    const media = 'http://media.example.test/';
    const requests = [];
    const fetchHosted = connect(() => assert.fail('Media used the Access bridge'), async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.url);
        assert.equal(request.headers.has('authorization'), false);
        assert.equal(request.headers.has('x-iptvnator-device-key'), false);
        return new Response(request.url.endsWith('.m3u8') ? 'segment.ts' : 'synthetic segment');
    });
    const manifest = await fetchHosted(media + 'live.m3u8');
    await fetchHosted(new URL(await manifest.text(), media));
    assert.deepEqual(requests, [media + 'live.m3u8', media + 'segment.ts']);
});

test('streams an Xtream catalog larger than the former 16 MiB limit', async () => {
    const chunk = Buffer.alloc(64 * 1024, 'a').toString('base64');
    const chunks = 272;
    let reads = 0;
    const fetchHosted = connect((request, reply) => {
        if (request.read) {
            reply(reads++ < chunks ? { chunk } : { done: true });
            return;
        }
        assert.equal(request.path, '/api/xtream?targetId=synthetic');
        assert.equal(request.method, 'GET');
        reply({ status: 200, headers: { 'content-type': 'application/octet-stream' }, stream: true });
    });
    const response = await fetchHosted(origin + '/api/xtream?targetId=synthetic');
    assert.equal(response.status, 200);
    const body = new Uint8Array(await response.arrayBuffer());
    assert.equal(body.length, 17 * 1024 * 1024);
    assert.equal(body[0], 97);
    assert.equal(body.at(-1), 97);
    assert.equal(reads, chunks + 1);
});

test('cancels a hosted request after response headers', async () => {
    const controller = new AbortController();
    let cancelled;
    const stopped = new Promise(resolve => { cancelled = resolve; });
    const fetchHosted = connect((request, reply) => {
        if (request.cancel) cancelled(request.id);
        else if (!request.read) reply({ status: 200, stream: true });
    });
    const response = await fetchHosted(origin + '/api/xtream', { signal: controller.signal });
    const read = response.arrayBuffer();
    controller.abort();
    await assert.rejects(read, { name: 'AbortError' });
    assert.equal(await stopped, '1');
});
