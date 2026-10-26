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
        const result = this.source.m3uItems
            ? { playlist: { items: this.source.m3uItems } }
            : ((await this.transport.request(
                  this.source,
                  'parse',
                  {},
                  signal
              )) as { playlist?: { items?: unknown } });
        this.items = rows(result.playlist?.items).map((raw) => {
            const url = text(raw.url);
            const kind = isLikelyM3uVod({ url, radio: raw.radio as string })
                ? 'movie'
                : 'live';
            const tvg = (raw.tvg ?? {}) as Record<string, unknown>;
            return {
                id: identity(this.source, kind, url),
                providerId: url,
                sourceId: this.source.id,
                kind,
                title: text(raw.name),
                category: text((raw.group as { title?: string })?.title),
                poster: artwork(tvg.logo),
                raw,
            };
        });
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
