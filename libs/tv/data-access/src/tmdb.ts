import {
    TmdbApiClient,
    TmdbIdResolver,
    TmdbMemoryCache,
    TmdbMetadataClient,
    extractYear,
    toTmdbLanguage,
    tmdbBackdropUrl,
    tmdbPosterUrl,
} from '@iptvnator/shared/tmdb';
import { artwork, Media, UserData } from '@iptvnator/tv/util';

/** The caller owns cancellation; the deadline also bounds offline/slow API calls. */
async function withDeadline<T>(
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>
) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel);
    if (signal.aborted) cancel();
    const timer = setTimeout(cancel, 8000);
    try {
        return await work(controller.signal);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}

export function checkTmdbKey(key: string, signal: AbortSignal) {
    return withDeadline(signal, (abort) =>
        new TmdbApiClient(abort).validateApiKey(key.trim())
    );
}

/** One settings snapshot owns its cache: replacing/disabling the key retires it. */
export class TvMetadata {
    private readonly cache = new TmdbMemoryCache();
    constructor(private readonly settings: UserData['tmdb']) {}
    async enrich(
        item: Media,
        signal: AbortSignal
    ): Promise<{ item: Media; failed: boolean }> {
        if (
            !this.settings.enabled ||
            !this.settings.apiKey.trim() ||
            !['movie', 'series'].includes(item.kind) ||
            signal.aborted
        )
            return { item, failed: false };
        return withDeadline(signal, async (abort) => {
            let failed = false;
            const runtime = {
                isEnabled: () => true,
                apiKey: () => this.settings.apiKey.trim(),
                appLanguage: () => this.settings.language,
                language: () => toTmdbLanguage(this.settings.language),
            };
            const api = new TmdbApiClient(abort);
            const client = new TmdbMetadataClient(
                runtime,
                api,
                this.cache,
                new TmdbIdResolver(runtime, api, this.cache),
                () => {
                    failed = true;
                }
            );
            const payload = item.raw.details as
                { info?: Record<string, unknown> } | undefined;
            const info = payload?.info ?? item.raw;
            const query = {
                title: item.title,
                originalTitle:
                    typeof info.original_name === 'string'
                        ? info.original_name
                        : undefined,
                year: extractYear(item.year, item.title),
                // Series provider IDs are not show-level TMDB IDs.
                tmdbId:
                    item.kind === 'movie'
                        ? (info.tmdb_id as string | number | undefined)
                        : undefined,
            };
            const details =
                item.kind === 'series'
                    ? await client.enrichTv(query)
                    : await client.enrichMovie(query);
            if (signal.aborted || abort.aborted || !details)
                return {
                    item,
                    failed: !signal.aborted && (failed || abort.aborted),
                };
            return {
                item: {
                    ...item,
                    poster:
                        artwork(tmdbPosterUrl(details.poster_path)) ??
                        item.poster,
                    backdrop:
                        artwork(tmdbBackdropUrl(details.backdrop_path)) ??
                        item.backdrop,
                    description: details.overview?.trim() || item.description,
                },
                failed,
            };
        });
    }
}
