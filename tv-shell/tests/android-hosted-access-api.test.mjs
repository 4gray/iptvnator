import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const bootstrap = readFileSync(new URL(
    '../android/app/src/main/assets/tvshell/hosted-access-api.js', import.meta.url
), 'utf8');
const origin = 'http://synthetic.iptvnator.localhost';

function connect(onRequest, directFetch = fetch, RequestClass = Request, page = new EventTarget()) {
    const bridge = {
        postMessage(data) {
            const request = JSON.parse(data);
            if (request.document) return;
            queueMicrotask(() => onRequest(request, result => {
                bridge.onmessage({ data: JSON.stringify({ id: request.id, ...result }) });
            }));
        },
    };
    const window = Object.assign(page, { HostedAccessApi: bridge, fetch: directFetch });
    runInNewContext(bootstrap, {
        window,
        location: new URL(origin),
        URL, Request: RequestClass, Response, ReadableStream, TransformStream, Uint8Array, DOMException, atob, btoa,
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

test('restoring a cached document drops uploads prepared during its previous visit', async () => {
    const page = new EventTarget();
    const fetchHosted = connect((request, reply) => {
        assert.equal(request.method, 'GET');
        reply({ status: 204 });
    }, fetch, Request, page);
    let bodyController;
    const body = new ReadableStream({ start(controller) { bodyController = controller; } });
    const sending = fetchHosted(origin + '/api/v1/sources/example', { method: 'PUT', body, duplex: 'half' });
    page.dispatchEvent(new Event('pagehide'));
    page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    bodyController.close();
    await assert.rejects(sending, { name: 'AbortError' });
    assert.equal((await fetchHosted(origin + '/api/v1/sources/example')).status, 204);
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

test('uploads and replays a large JSON playlist in bounded messages', async () => {
    const rawM3u = '#EXTM3U\n' + '# Synthetic channel metadata\n'.repeat(620_000);
    const body = JSON.stringify({ id: 'example', title: 'Example', kind: 'm3u-text', rawM3u });
    assert(Buffer.byteLength(body) > 16 * 1024 * 1024);
    let offset = 0;
    let pass = 0;
    const fetchHosted = connect((request, reply) => {
        if (request.path) {
            assert.equal(request.bodySize, Buffer.byteLength(body));
            assert.equal(request.body, undefined);
        } else {
            assert.equal(request.uploadOffset, offset);
            const bytes = Buffer.from(request.chunk, 'base64');
            assert(bytes.length > 0 && bytes.length <= 64 * 1024);
            assert.equal(bytes.toString(), body.slice(offset, offset + bytes.length));
            offset += bytes.length;
            if (offset === body.length) {
                if (++pass === 2) return reply({ status: 201 });
                offset = 0;
            }
        }
        reply({ uploadOffset: offset });
    });
    const result = await fetchHosted(origin + '/api/v1/sources/example', { method: 'PUT', body });
    assert.equal(result.status, 201);
    assert.equal(pass, 2);
});

test('preserves a Request payload in WebViews without the Request.body getter', async () => {
    class OlderRequest extends Request { get body() { return undefined; } }
    const body = 'synthetic request body';
    const fetchHosted = connect((request, reply) => {
        if (request.path) {
            assert.equal(request.bodySize, body.length);
            reply({ uploadOffset: 0 });
        } else {
            assert.equal(Buffer.from(request.chunk, 'base64').toString(), body);
            reply({ status: 204 });
        }
    }, fetch, OlderRequest);
    const response = await fetchHosted(new OlderRequest(origin + '/api/v1/sources/example', { method: 'PUT', body }));
    assert.equal(response.status, 204);
});

test('cancels a hosted playlist request before response headers', async () => {
    const controller = new AbortController();
    const requests = [];
    const fetchHosted = connect(request => requests.push(request));
    const response = fetchHosted(origin + '/api/parse', { signal: controller.signal });
    controller.abort();
    await assert.rejects(response, { name: 'AbortError' });
    assert.equal(requests[0].path, '/api/parse');
    assert.deepEqual(requests[1], { id: requests[0].id, cancel: true });
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

test('aborting during an upload cancels the native request', async () => {
    const controller = new AbortController();
    let cancelled;
    const stopped = new Promise(resolve => { cancelled = resolve; });
    const fetchHosted = connect((request, reply) => {
        if (request.cancel) cancelled(request.id);
        else if (request.path) reply({ uploadOffset: 0 });
        else {
            assert.equal(request.uploadOffset, 0);
            assert.equal(Buffer.from(request.chunk, 'base64').length, 64 * 1024);
            controller.abort();
        }
    });
    const response = fetchHosted(origin + '/api/v1/sources/example', {
        method: 'PUT', body: 'x'.repeat(128 * 1024), signal: controller.signal,
    });
    await assert.rejects(response, { name: 'AbortError' });
    assert.equal(await stopped, '1');
});

test('rejects an upload above the serialized document limit before sending metadata', async () => {
    const oneMiB = new Uint8Array(1024 * 1024);
    let count = 0;
    const body = new ReadableStream({
        pull(controller) {
            if (count++ < 64) controller.enqueue(oneMiB);
            else {
                controller.enqueue(Uint8Array.of(1));
                controller.close();
            }
        },
    });
    const fetchHosted = connect(() => assert.fail('Oversized body reached native transport'));
    await assert.rejects(fetchHosted(origin + '/api/v1/sources/example', {
        method: 'PUT', body, duplex: 'half',
    }), /Hosted request too large/);
});
