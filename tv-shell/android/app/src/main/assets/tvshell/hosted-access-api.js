(() => {
    const bridge = window.HostedAccessApi;
    const baseFetch = window.fetch.bind(window);
    const pending = new Map();
    const chunkBytes = 64 * 1024;
    const maxUploadBytes = 64 * 1024 * 1024;
    let nextId = 0;

    function finish(id, request) {
        pending.delete(id);
        request.body = null;
        request.signal.removeEventListener('abort', request.cancel);
        request.pulled?.();
        request.pulled = null;
    }

    bridge.onmessage = async ({ data }) => {
        const result = JSON.parse(data);
        const request = pending.get(result.id);
        if (!request) return;
        if (result.uploadOffset !== undefined) {
            try {
                const offset = result.uploadOffset;
                if (!Number.isSafeInteger(offset) || offset < 0 || offset >= request.body.size)
                    throw new TypeError('Invalid upload offset');
                const bytes = new Uint8Array(await request.body.slice(offset, offset + chunkBytes).arrayBuffer());
                if (!pending.has(result.id)) return;
                let text = '';
                for (let i = 0; i < bytes.length; i += 8192)
                    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
                bridge.postMessage(JSON.stringify({ id: result.id, uploadOffset: offset, chunk: btoa(text) }));
            } catch (error) {
                if (!pending.has(result.id)) return;
                request.stop();
                request.reject(error);
            }
            return;
        }
        if (result.error) {
            finish(result.id, request);
            const error = new TypeError('Hosted API unavailable');
            if (request.controller) request.controller.error(error);
            else request.reject(error);
            return;
        }
        if (result.chunk !== undefined) {
            request.controller.enqueue(Uint8Array.from(atob(result.chunk), char => char.charCodeAt(0)));
            request.pulled?.();
            request.pulled = null;
            return;
        }
        if (result.done) {
            finish(result.id, request);
            request.controller.close();
            return;
        }
        request.body = null;
        const status = result.reauth ? 401 : result.status;
        const body = result.stream ? new ReadableStream({
            start(controller) { request.controller = controller; },
            pull() {
                return new Promise(resolve => {
                    request.pulled = resolve;
                    bridge.postMessage(JSON.stringify({ id: result.id, read: true }));
                });
            },
            cancel() { request.stop(); },
        }) : null;
        if (!body) finish(result.id, request);
        request.resolve(new Response(body, { status, headers: result.headers }));
    };

    window.fetch = async (input, options) => {
        const url = new URL(input instanceof Request ? input.url : input, location.href);
        if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
            return baseFetch(input, options);
        }
        const request = new Request(input instanceof Request ? input : url.href, options);
        const id = String(++nextId);
        const headers = Object.fromEntries(request.headers.entries());
        let body = null;
        if (request.body) {
            let size = 0;
            const bounded = request.body.pipeThrough(new TransformStream({
                transform(chunk, stream) {
                    size += chunk.byteLength;
                    if (size > maxUploadBytes) throw new TypeError('Hosted request too large');
                    stream.enqueue(chunk);
                },
            }), { signal: request.signal });
            // The native HTTP client may replay the body after an Access challenge.
            body = await new Response(bounded).blob();
        } else if (request.method !== 'GET' && request.method !== 'HEAD') {
            // Older WebViews expose blob() but omit Request.body.
            body = await request.blob();
            if (body.size > maxUploadBytes) throw new TypeError('Hosted request too large');
        }
        const metadata = JSON.stringify({
            id, path: url.pathname + url.search, method: request.method, headers, bodySize: body?.size ?? 0,
        });
        if (metadata.length > 128 * 1024) throw new TypeError('Hosted request headers too large');
        return new Promise((resolve, reject) => {
            const entry = { resolve, reject, signal: request.signal, body };
            const stop = () => {
                finish(id, entry);
                bridge.postMessage(JSON.stringify({ id, cancel: true }));
            };
            const cancel = () => {
                stop();
                const error = request.signal.reason ?? new DOMException('Aborted', 'AbortError');
                if (entry.controller) entry.controller.error(error);
                else reject(error);
            };
            if (request.signal.aborted) {
                reject(request.signal.reason ?? new DOMException('Aborted', 'AbortError'));
                return;
            }
            Object.assign(entry, { cancel, stop });
            request.signal.addEventListener('abort', cancel, { once: true });
            pending.set(id, entry);
            try {
                bridge.postMessage(metadata);
            } catch (error) {
                finish(id, entry);
                reject(error);
            }
        });
    };
})();
