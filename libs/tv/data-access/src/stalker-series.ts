import {
    mapRegularSeriesSeasons,
    mapRegularSeriesEpisodes,
    mapVodSeriesSeasonsToVm,
    mapVodSeriesEpisodes,
    StalkerMappedEpisode,
    sortByNumericValue,
    sortVodSeriesSeasonsByNumber,
    sortEpisodesByNumber,
    resolveStalkerEpisodeCommand,
    type StalkerEpisodeCommand,
} from '@iptvnator/portal/stalker/client';
import { isStalkerSeriesFlag } from '@iptvnator/shared/interfaces';
import {
    Media,
    Source,
    identity,
    rows,
    withSeriesContext,
} from '@iptvnator/tv/util';
import { StalkerSession } from './stalker-session';
export function unwrap(value: unknown): unknown {
    const js = (value as { js?: unknown })?.js;
    return js && typeof js === 'object' && 'data' in js
        ? (js as { data: unknown }).data
        : js;
}
export async function stalkerEpisodeCommand(
    session: StalkerSession,
    source: Source,
    item: Media,
    signal: AbortSignal
): Promise<string> {
    let descriptor = item.raw.lazyEpisode as StalkerEpisodeCommand | undefined;
    // Older TV progress stores an invented file command without season IDs.
    // Refresh the exact parent-scoped episode before resolving; retain its ID/position.
    if (
        !descriptor &&
        item.raw.series === undefined &&
        String(item.raw.cmd ?? '').startsWith('/media/file_')
    ) {
        let parent: unknown;
        try {
            parent = JSON.parse(item.parentId ?? '');
        } catch {
            /* Invalid legacy identity. */
        }
        if (
            !Array.isArray(parent) ||
            parent[0] !== source.id ||
            parent[1] !== 'stalker' ||
            parent[2] !== 'series' ||
            typeof parent[3] !== 'string' ||
            !parent[3].startsWith('movie:')
        )
            throw new Error('Reopen this series to refresh its episode.');
        const episodes = await stalkerEpisodes(
            session,
            source,
            {
                ...item,
                id: item.parentId!,
                providerId: parent[3].slice(6),
                kind: 'series',
                raw: { origin: 'vod', is_series: true },
            },
            signal
        );
        descriptor = episodes.find((episode) => episode.id === item.id)?.raw
            .lazyEpisode as StalkerEpisodeCommand | undefined;
        if (!descriptor)
            throw new Error(
                'Saved episode is no longer supplied by this series.'
            );
    }
    return descriptor
        ? resolveStalkerEpisodeCommand(descriptor, (params) =>
              session.request(params, signal)
          )
        : typeof item.raw.cmd === 'string'
          ? item.raw.cmd
          : '';
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
            episodes.push(
                withSeriesContext(
                    {
                        id: identity(source, 'episode', coordinates),
                        sourceId: source.id,
                        providerId: e.originalId ?? e.id,
                        kind: 'episode',
                        title: e.title || `Episode ${e.episode_num}`,
                        season: e.season,
                        episode: e.episode_num,
                        parentId: item.id,
                        seriesTitle: item.title,
                        seriesYear: item.year,
                        backdrop: item.backdrop,
                        poster: item.poster,
                        raw: {
                            cmd: e.originalCmd,
                            ...(lazy
                                ? {
                                      lazyEpisode: {
                                          originalCmd: e.originalCmd,
                                          custom_sid: e.custom_sid,
                                          vodEpisode: e.vodEpisode,
                                      },
                                  }
                                : {}),
                            origin: 'vod',
                            series: lazy ? undefined : e.episode_num,
                        },
                    },
                    item
                )
            );
        })
    );
    return episodes;
}
