import {
    resolveStalkerStaticPlaybackUrl,
    resolveStalkerPlaybackUrl,
    shouldResolveMovieFileId,
    StalkerPagedCatalog,
    resolveStalkerArtwork,
} from '@iptvnator/portal/stalker/client';
import {
    isStalkerSeriesItem,
    isStalkerStreamCredentialSafe,
} from '@iptvnator/shared/interfaces';
import {
    Catalog,
    Kind,
    Media,
    Source,
    ProviderClient,
    rows,
    text,
    identity,
} from '@iptvnator/tv/util';
import { StalkerSession } from './stalker-session';
import { stalkerEpisodes, unwrap } from './stalker-series';
import { ProviderTransport } from './transport';
export class StalkerProvider implements ProviderClient {
    readonly capabilities = {
        live: true,
        movies: true,
        series: true,
        epg: true,
    };
    private session: StalkerSession;
    private pages: StalkerPagedCatalog;
    private bulk?: Record<string, unknown>;
    constructor(
        private source: Source,
        transport: ProviderTransport,
        save: (s: Source) => Promise<void>
    ) {
        this.session = new StalkerSession(source, transport, save);
        this.pages = new StalkerPagedCatalog((params, signal) =>
            this.session.request(params, signal)
        );
    }
    connect(signal: AbortSignal) {
        return this.session.discover(signal);
    }
    private media(raw: Record<string, unknown>, kind: Kind): Media {
        const id = [raw.id, raw.stream_id, raw.movie_id].find(
            (v) => v != null && String(v).trim()
        );
        const actualKind =
            kind === 'movie' && isStalkerSeriesItem(raw) ? 'series' : kind;
        return {
            id: identity(this.source, actualKind, `${kind}:${id}`),
            sourceId: this.source.id,
            providerId: text(id),
            kind: actualKind,
            title: text(raw.o_name ?? raw.name ?? raw.title),
            poster: resolveStalkerArtwork(
                this.source.endpoint ?? this.source.url,
                raw.cover,
                raw.screenshot_uri,
                raw.logo,
                raw.poster_url
            ),
            description: text(raw.description),
            year: text(raw.year),
            category: text(raw.category_id),
            raw: {
                ...raw,
                origin:
                    kind === 'movie'
                        ? 'vod'
                        : kind === 'live'
                          ? 'itv'
                          : 'series',
            },
        };
    }
    async catalog(
        kind: Kind,
        category: string,
        page: number,
        query: string,
        signal: AbortSignal
    ): Promise<Catalog> {
        const type =
            kind === 'movie' ? 'vod' : kind === 'live' ? 'itv' : 'series';
        const categories = rows(
            unwrap(
                await this.session.request(
                    {
                        type,
                        action:
                            kind === 'live' ? 'get_genres' : 'get_categories',
                    },
                    signal
                )
            )
        ).map((c) => ({ id: text(c.id), name: text(c.title ?? c.name) }));
        const response = await this.pages.load(
            {
                type,
                category: category || '*',
                genre: category || '*',
                search: query,
            },
            page,
            signal
        );
        return {
            items: response.data.map((r) => this.media(r, kind)),
            page,
            pageSize: response.pageSize,
            total: response.total,
            categories,
        };
    }
    async details(item: Media) {
        return {
            ...item,
            poster:
                item.poster ??
                resolveStalkerArtwork(
                    this.source.endpoint ?? this.source.url,
                    item.raw.cover,
                    item.raw.screenshot_uri,
                    item.raw.logo,
                    item.raw.poster_url
                ),
        };
    }
    episodes(item: Media, signal: AbortSignal) {
        return stalkerEpisodes(this.session, this.source, item, signal);
    }
    async epg(item: Media, signal: AbortSignal) {
        if (!this.bulk) {
            try {
                this.bulk = unwrap(
                    await this.session.request(
                        { type: 'itv', action: 'get_epg_info', period: 168 },
                        signal
                    )
                ) as Record<string, unknown>;
            } catch {
                if (signal.aborted)
                    throw new DOMException('Aborted', 'AbortError');
            }
        }
        let data = rows(this.bulk?.[item.providerId]);
        if (!data.length)
            data = rows(
                unwrap(
                    await this.session.request(
                        {
                            type: 'itv',
                            action: 'get_short_epg',
                            ch_id: item.providerId,
                            size: 12,
                        },
                        signal
                    )
                )
            );
        return data
            .map((p) => ({
                title: text(p.name ?? p.title),
                description: text(p.descr),
                start:
                    Number(p.start_timestamp) * 1000 ||
                    Date.parse(text(p.time).replace(' ', 'T')),
                end:
                    Number(p.stop_timestamp) * 1000 ||
                    Date.parse(text(p.time_to).replace(' ', 'T')),
            }))
            .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end));
    }
    async resolve(item: Media, signal: AbortSignal) {
        let cmd = text(item.raw.cmd);
        if (!cmd) throw new Error('Provider supplied no playback command.');
        if (shouldResolveMovieFileId(item.raw, cmd)) {
            const files = rows(
                unwrap(
                    await this.session.request(
                        {
                            type: 'vod',
                            action: 'get_ordered_list',
                            movie_id: item.providerId,
                            p: 1,
                        },
                        signal
                    )
                )
            );
            if (!files[0]?.id) throw new Error('Movie has no playable file.');
            cmd = `/media/file_${files[0].id}.mpg`;
        }
        let url =
            item.kind !== 'episode'
                ? resolveStalkerStaticPlaybackUrl(item.raw, cmd)
                : undefined;
        if (!url) {
            const result = (await this.session.request(
                {
                    type:
                        item.kind === 'live'
                            ? 'itv'
                            : item.raw.origin === 'series'
                              ? 'series'
                              : 'vod',
                    action: 'create_link',
                    cmd,
                    disable_ad: '0',
                    download: '0',
                    ...(item.raw.series && item.kind === 'episode'
                        ? { type: 'vod', series: Number(item.raw.series) }
                        : {}),
                },
                signal
            )) as { js?: { cmd?: string } };
            url = resolveStalkerPlaybackUrl(
                this.source.endpoint ?? this.source.url,
                cmd,
                result?.js?.cmd ?? ''
            );
        }
        if (!url || !/^https?:\/\//i.test(url))
            throw new Error('No playable HTTP stream was returned.');
        return {
            url,
            requiresHeaders: isStalkerStreamCredentialSafe(
                this.source.endpoint ?? this.source.url,
                url
            ),
        };
    }
    dispose() {
        this.session.dispose();
        this.pages.clear();
    }
}
