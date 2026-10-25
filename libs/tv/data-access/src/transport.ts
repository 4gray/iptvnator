import { httpUrl, Source } from '@iptvnator/tv/util';
export class ProviderRequestError extends Error {
    constructor(
        readonly status: number,
        readonly upstream = false,
        readonly missingTarget = false
    ) {
        super('Provider request failed. Check the source and backend.');
    }
}
export class ProviderTransport {
    private targets = new Map<string, string>();
    constructor(
        readonly backend: string,
        private readonly accessToken = ''
    ) {
        httpUrl(backend);
    }
    private async json(
        url: string,
        signal: AbortSignal,
        init?: RequestInit
    ): Promise<unknown> {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal.addEventListener('abort', cancel);
        if (signal.aborted) cancel();
        const timer = setTimeout(cancel, 35000);
        try {
            const response = await fetch(url, {
                ...init,
                signal: controller.signal,
                redirect: 'error',
                headers: {
                    ...(this.accessToken
                        ? { Authorization: `Bearer ${this.accessToken}` }
                        : {}),
                    ...init?.headers,
                },
            });
            if (!response.ok) {
                const body =
                    response.status === 404
                        ? await response.json().catch(() => null)
                        : null;
                throw new ProviderRequestError(
                    response.status,
                    false,
                    body?.message === 'Provider target not found'
                );
            }
            const value = await response.json();
            if (
                value?.type === 'ERROR' ||
                value?.status >= 400 ||
                (value?.message && !('payload' in value))
            )
                throw new ProviderRequestError(
                    Number(value?.status) || 502,
                    true
                );
            return value;
        } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
        }
    }
    private async target(url: string, signal: AbortSignal) {
        const cached = this.targets.get(url);
        if (cached) return cached;
        const promise = this.json(
            `${this.backend.replace(/\/$/, '')}/provider-targets`,
            signal,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: httpUrl(url) }),
            }
        ).then((v) => (v as { targetId: string }).targetId);
        const id = await promise;
        this.targets.set(url, id);
        return id;
    }
    async request(
        source: Source,
        route: 'xtream' | 'stalker' | 'parse',
        params: Record<string, string | number>,
        signal: AbortSignal,
        endpoint = source.endpoint ?? source.url,
        repaired = false
    ): Promise<unknown> {
        const targetId = await this.target(endpoint, signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const query = new URLSearchParams({ targetId });
        if (route === 'parse' && source.userAgent)
            query.set('userAgent', source.userAgent);
        Object.keys(params).forEach((k) => query.set(k, String(params[k])));
        let result: { payload?: unknown };
        try {
            result = (await this.json(
                `${this.backend.replace(/\/$/, '')}/${route}?${query}`,
                signal
            )) as { payload?: unknown };
        } catch (error) {
            if (
                !repaired &&
                !signal.aborted &&
                error instanceof ProviderRequestError &&
                error.missingTarget
            ) {
                // Backend restart drops its in-memory target registry. Repair once;
                // never retry an upstream/provider 404 or loop on an incompatible API.
                this.targets.delete(endpoint);
                return this.request(
                    source,
                    route,
                    params,
                    signal,
                    endpoint,
                    true
                );
            }
            throw error;
        }
        return route === 'parse' ? result : result.payload;
    }
    clear() {
        this.targets.clear();
    }
}
