import { isLikelyM3uVod } from '@iptvnator/shared/m3u-utils';
import {
    Catalog,
    CatalogSort,
    sortCatalog,
    catalogTitleMatcher,
    Kind,
    Media,
    Source,
    ProviderClient,
    rows,
    text,
    artwork,
    identity,
} from '@iptvnator/tv/util';
import { ProviderTransport } from './transport';
export class M3uProvider implements ProviderClient {
    readonly capabilities = {
        live: true,
        movies: true,
        series: false,
        epg: false,
    };
    private items: Media[] = [];
    constructor(
        private source: Source,
        private transport: ProviderTransport
    ) {}
    async connect(signal: AbortSignal) {
        this.items = (
            await loadM3uItems(this.source, this.transport, signal)
        ).map((raw) => m3uMedia(this.source, raw));
        return this.source;
    }
    async catalog(
        kind: Kind,
        category: string,
        page: number,
        query: string,
        _signal?: AbortSignal,
        sort: CatalogSort = 'recent'
    ): Promise<Catalog> {
        const all = this.items.filter((i) => i.kind === kind);
        const categories = Array.from(
            new Set(all.map((i) => i.category ?? '').filter(Boolean))
        ).map((id) => ({ id, name: id }));
        const matchesTitle = catalogTitleMatcher(query);
        const items = all.filter(
            (i) =>
                (!category || i.category === category) && matchesTitle(i.title)
        );
        return {
            items: sortCatalog(
                items,
                kind === 'live' ? 'provider' : sort
            ).slice(page * 60, (page + 1) * 60),
            total: items.length,
            categories,
            page,
        };
    }
    async details(item: Media) {
        return item;
    }
    async episodes() {
        return [];
    }
    async epg() {
        return [];
    }
    async resolve(item: Media) {
        if (item.raw.drm)
            throw new Error('DRM streams are outside this prototype.');
        return { url: text(item.raw.url) };
    }
    dispose() {
        this.items = [];
    }
}

export async function loadM3uItems(
    source: Source,
    transport: ProviderTransport,
    signal: AbortSignal
) {
    if (source.m3uItems) return source.m3uItems;
    const result = (await transport.request(source, 'parse', {}, signal)) as {
        playlist?: { items?: unknown };
    };
    return rows(result.playlist?.items);
}

export function m3uMedia(source: Source, raw: Record<string, unknown>): Media {
    const url = text(raw.url);
    const kind = isLikelyM3uVod({ url, radio: raw.radio as string })
        ? 'movie'
        : 'live';
    const tvg = (raw.tvg ?? {}) as Record<string, unknown>;
    const category = text((raw.group as { title?: string })?.title);
    return {
        id: identity(source, kind, url),
        providerId: url,
        sourceId: source.id,
        kind,
        title: text(raw.name),
        category,
        categoryName: category,
        poster: artwork(tvg.logo),
        raw,
    };
}
