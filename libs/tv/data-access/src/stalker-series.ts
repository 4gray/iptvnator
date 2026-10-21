import {
    mapRegularSeriesSeasons,
    mapRegularSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
    mapVodSeriesEpisodes,
    StalkerMappedEpisode,
    sortByNumericValue,
    sortVodSeriesSeasonsByNumber,
    sortEpisodesByNumber,
} from '@iptvnator/portal/stalker/client';
import { isStalkerSeriesFlag } from '@iptvnator/shared/interfaces';
import { Media, Source, identity, rows } from '@iptvnator/tv/util';
import { StalkerSession } from './stalker-session';
export function unwrap(value: unknown): unknown {
    const js = (value as { js?: unknown })?.js;
    return js && typeof js === 'object' && 'data' in js
        ? (js as { data: unknown }).data
        : js;
}
async function orderedRows(
    session: StalkerSession,
    params: Record<string, string | number>,
    signal: AbortSignal
) {
    const result: Record<string, unknown>[] = [];
    let page = 1;
    let total = Infinity;
    const seen = new Set<string>();
    while (result.length < total) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const response = (await session.request(
            { action: 'get_ordered_list', ...params, p: page },
            signal
        )) as { js?: { total_items?: number } };
        const value = unwrap(response);
        if (!Array.isArray(value))
            throw new Error('Invalid series response. Retry this series.');
        const data = rows(value);
        if (!data.length) break;
        const fingerprint = JSON.stringify(data.map((r) => r.id));
        if (seen.has(fingerprint))
            throw new Error('Provider did not advance the series page.');
        seen.add(fingerprint);
        result.push(...data);
        total = Number(response?.js?.total_items ?? result.length);
        page++;
    }
    return result;
}
export async function stalkerEpisodes(
    session: StalkerSession,
    source: Source,
    item: Media,
    signal: AbortSignal
): Promise<Media[]> {
    const raw = item.raw;
    const embedded = Array.isArray(raw.series) && raw.series.length > 0;
    let lazy =
        raw.origin === 'vod' && isStalkerSeriesFlag(raw.is_series) && !embedded;
    const seasonsRaw = embedded
        ? []
        : await orderedRows(
              session,
              {
                  type: lazy ? 'vod' : 'series',
                  movie_id: lazy
                      ? item.providerId
                      : item.providerId.split(':')[0],
              },
              signal
          );
    // Some Ministra panels mark a VOD series but return regular cmd/series[] seasons.
    if (
        lazy &&
        seasonsRaw.length &&
        seasonsRaw.every((s) => Array.isArray(s.series))
    )
        lazy = false;
    let mapped: Record<string, unknown[]>;
    if (lazy) {
        if (seasonsRaw.some((s) => s.is_season !== true))
            throw new Error('Provider supplied unrecognizable seasons.');
        const seasons = mapVodSeriesSeasonsToVm(
            sortVodSeriesSeasonsByNumber(
                seasonsRaw as unknown as Parameters<
                    typeof sortVodSeriesSeasonsByNumber
                >[0]
            ),
            item.title
        );
        for (const season of seasons) {
            const episodes = await orderedRows(
                session,
                {
                    type: 'vod',
                    movie_id: season.video_id || item.providerId,
                    season_id: season.id,
                },
                signal
            );
            if (episodes.some((e) => e.is_episode !== true))
                throw new Error('Provider supplied unrecognizable episodes.');
            season.episodes = sortEpisodesByNumber(
                episodes as unknown as Parameters<
                    typeof sortEpisodesByNumber
                >[0]
            );
        }
        mapped = mapVodSeriesEpisodes(seasons, {
            parentSeriesId: item.providerId,
            fallbackPoster: item.poster,
        }) as unknown as Record<string, unknown[]>;
    } else {
        const seasons = mapRegularSeriesSeasons(
            embedded
                ? (raw as unknown as Parameters<
                      typeof mapRegularSeriesSeasons
                  >[0])
                : null,
            sortByNumericValue(
                seasonsRaw as unknown as Parameters<
                    typeof sortByNumericValue
                >[0]
            )
        );
        mapped = mapRegularSeriesEpisodes(
            seasons,
            item.poster,
            item.title
        ) as unknown as Record<string, unknown[]>;
    }
    const episodes: Media[] = [];
    Object.keys(mapped).forEach((season) =>
        mapped[season].forEach((value) => {
            const e = value as StalkerMappedEpisode;
            const coordinates = JSON.stringify([
                item.id,
                season,
                e.originalId ?? e.id,
                e.episode_num,
            ]);
            episodes.push({
                id: identity(source, 'episode', coordinates),
                sourceId: source.id,
                providerId: e.originalId ?? e.id,
                kind: 'episode',
                title: e.title || `Episode ${e.episode_num}`,
                season: e.season,
                episode: e.episode_num,
                parentId: item.id,
                poster: item.poster,
                raw: {
                    cmd: lazy
                        ? `/media/file_${e.originalId}.mpg`
                        : e.originalCmd,
                    origin: 'vod',
                    series: lazy ? undefined : e.episode_num,
                },
            });
        })
    );
    return episodes;
}
