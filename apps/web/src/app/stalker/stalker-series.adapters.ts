import { XtreamSerieEpisode } from 'shared-interfaces';
import {
    StalkerSeason,
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
    StalkerVodSource,
} from './models';
import { isStalkerSeriesFlag } from './stalker-vod.utils';

export interface VodSeriesSeasonVm {
    id: string;
    video_id: string;
    name: string;
    season_number: string;
    episodes: StalkerVodSeriesEpisode[];
    isLoading: boolean;
    isExpanded: boolean;
}

export interface StalkerSeriesSeasonVm {
    id: string;
    name: string;
    cmd?: string;
    series: number[];
}

export interface StalkerMappedEpisode extends XtreamSerieEpisode {
    originalId?: string;
    originalCmd?: string;
}

function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

function generateEpisodeId(
    seed: string,
    episodeNum: number,
    seasonKey: string,
    isVodSeries: boolean
): number {
    if (isVodSeries) {
        return hashString(`vod_${seasonKey}_${episodeNum}`);
    }
    return hashString(`${seed}_ep_${episodeNum}`);
}

function toEpisodeNumber(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function toNonEmptyString(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim() !== '') {
        return value;
    }
    return fallback;
}

function toSeriesNumbers(values: unknown[] | undefined): number[] {
    if (!Array.isArray(values)) {
        return [];
    }
    return values
        .map((value) => toEpisodeNumber(value))
        .filter((value) => value > 0);
}

export function isVodSeriesItem(
    item: Pick<StalkerVodSource, 'is_series'> | null | undefined
): boolean {
    return isStalkerSeriesFlag(item?.is_series);
}

export function mapVodSeriesSeasonsToVm(
    seasons: StalkerVodSeriesSeason[] | undefined
): VodSeriesSeasonVm[] {
    return (seasons ?? []).map((season) => ({
        id: String(season.id),
        video_id: String(season.video_id),
        name: toNonEmptyString(
            season.name,
            `Season ${toNonEmptyString(season.season_number, '0')}`
        ),
        season_number: toNonEmptyString(season.season_number, ''),
        episodes: [],
        isLoading: false,
        isExpanded: false,
    }));
}

export function mapRegularSeriesSeasons(
    vodWithSeries: StalkerVodSource | null,
    serialSeasons: StalkerSeason[] | undefined
): StalkerSeriesSeasonVm[] {
    if (vodWithSeries?.series && vodWithSeries.series.length > 0) {
        return [
            {
                id: String(vodWithSeries.id),
                name: vodWithSeries.info?.name || 'Episodes',
                cmd: vodWithSeries.cmd,
                series: toSeriesNumbers(vodWithSeries.series),
            },
        ];
    }

    return (serialSeasons ?? []).map((season) => ({
        id: String(season.id),
        name: season.name,
        cmd: season.cmd,
        series: toSeriesNumbers(season.series),
    }));
}

function createBaseEpisode(
    id: number,
    episodeNum: number,
    title: string,
    containerExtension: string,
    customSid: string,
    season: number,
    info: XtreamSerieEpisode['info']
): XtreamSerieEpisode {
    return {
        id: String(id),
        episode_num: episodeNum,
        title,
        container_extension: containerExtension,
        info,
        custom_sid: customSid,
        added: '',
        season,
        direct_source: '',
    };
}

export function mapVodSeriesEpisodes(
    seasons: ReadonlyArray<VodSeriesSeasonVm>,
    fallbackPoster?: string
): Record<string, XtreamSerieEpisode[]> {
    const mapped: Record<string, XtreamSerieEpisode[]> = {};

    seasons.forEach((season) => {
        const seasonKey = season.season_number || season.name || season.id;
        const seasonNum = toEpisodeNumber(seasonKey) || 1;

        mapped[seasonKey] = (season.episodes ?? []).map((episode) => {
            const episodeNum =
                toEpisodeNumber(episode.series_number) ||
                toEpisodeNumber(episode.episode_num);
            const trackingId = generateEpisodeId(
                String(episode.id ?? ''),
                episodeNum,
                seasonKey,
                true
            );

            return {
                ...createBaseEpisode(
                    trackingId,
                    episodeNum,
                    episode.name || `Episode ${episodeNum}`,
                    'mpg',
                    'vod-series',
                    seasonNum,
                    {
                        movie_image: episode.cover || fallbackPoster,
                        plot: episode.description || '',
                        duration: episode.duration
                            ? `${episode.duration} min`
                            : '',
                    }
                ),
                originalId: String(episode.id ?? ''),
            } as StalkerMappedEpisode;
        });
    });

    return mapped;
}

export function mapRegularSeriesEpisodes(
    seasons: ReadonlyArray<StalkerSeriesSeasonVm>,
    fallbackPoster?: string
): Record<string, XtreamSerieEpisode[]> {
    const mapped: Record<string, XtreamSerieEpisode[]> = {};

    seasons.forEach((season, index) => {
        const seasonKey = String(index + 1);
        mapped[seasonKey] = (season.series ?? []).map((episodeNum) => {
            const trackingId = generateEpisodeId(
                String(season.cmd ?? ''),
                episodeNum,
                seasonKey,
                false
            );

            return {
                ...createBaseEpisode(
                    trackingId,
                    episodeNum,
                    `Episode ${episodeNum}`,
                    '',
                    'regular-series',
                    Number(seasonKey),
                    {
                        movie_image: fallbackPoster,
                    }
                ),
                originalCmd: season.cmd,
            } as StalkerMappedEpisode;
        });
    });

    return mapped;
}

export function getVodSeriesSeasonKey(season: VodSeriesSeasonVm): string {
    return season.season_number || season.name || season.id;
}
