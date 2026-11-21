(() => {
    const bridge = window.HostedAccessApi;
    const baseFetch = window.fetch.bind(window);
    const pending = new Map();
    let nextId = 0;

    function finish(id, request) {
        pending.delete(id);
        request.signal.removeEventListener('abort', request.cancel);
        request.pulled?.();
        request.pulled = null;
    }

    bridge.onmessage = ({ data }) => {
        const result = JSON.parse(data);
        const request = pending.get(result.id);
        if (!request) return;
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
        const request = new Request(url.href, input instanceof Request ? new Request(input, options) : options);
        const id = String(++nextId);
        const headers = Object.fromEntries(request.headers.entries());
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length > 16 * 1024 * 1024) throw new TypeError('Hosted request too large');
        let text = '';
        for (let index = 0; index < bytes.length; index += 8192) {
            text += String.fromCharCode(...bytes.subarray(index, index + 8192));
        }
        return new Promise((resolve, reject) => {
            const entry = { resolve, reject, signal: request.signal };
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
                bridge.postMessage(JSON.stringify({
                    id, path: url.pathname + url.search, method: request.method, headers, body: btoa(text),
                }));
            } catch (error) {
                finish(id, entry);
                reject(error);
            }
        });
    };
})();
