import {
    XtreamSerieEpisode,
    resolveEnrichmentSeasonNumber,
} from '@iptvnator/shared/interfaces';
import {
    StalkerSeason,
    StalkerVodSeriesEpisode,
    StalkerVodSeriesSeason,
    StalkerVodSource,
} from './models';
import { isStalkerSeriesFlag } from './stalker-vod.utils';

const naturalSeasonCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base',
});

export interface VodSeriesSeasonVm {
    id: string;
    video_id: string;
    name: string;
    season_number: string;
    /** Original provider coordinates, retained when the title corrects a slice. */
    providerSeasonKey?: string;
    providerSeasonNumber?: number;
    episodes: StalkerVodSeriesEpisode[];
    isLoading: boolean;
    isExpanded: boolean;
    /**
     * True once the portal has answered an episode fetch for this season —
     * including an EMPTY answer. Distinguishes "loaded and empty per portal"
     * from "not fetched yet": `episodes.length === 0` alone conflates them,
     * which would keep an empty season permanently counted as unloaded.
     */
    episodesLoaded?: boolean;
}

export interface StalkerSeriesSeasonVm {
    id: string;
    name: string;
    cmd?: string;
    series: number[];
}

export interface MapVodSeriesEpisodesOptions {
    parentSeriesId: string | number;
    fallbackPoster?: string;
}

export interface StalkerMappedEpisode extends XtreamSerieEpisode {
    legacyTrackingId?: number;
    /** Allows pre-correction legacy progress to match the same episode. */
    providerSeasonNumber?: number;
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

function generateLegacyVodEpisodeId(
    episodeNum: number,
    seasonKey: string
): number {
    return hashString(`vod_${seasonKey}_${episodeNum}`);
}

function generateVodEpisodeId(options: {
    parentSeriesId: string | number;
    providerEpisodeId: string;
    seasonKey: string;
    episodeNum: number;
}): number {
    return hashString(
        JSON.stringify([
            'vod',
            String(options.parentSeriesId),
            options.providerEpisodeId,
            options.seasonKey,
            options.episodeNum,
        ])
    );
}

function generateRegularEpisodeId(seed: string, episodeNum: number): number {
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
    seasons: StalkerVodSeriesSeason[] | undefined,
    rawTitle?: string | null
): VodSeriesSeasonVm[] {
    const mapped = (seasons ?? []).map((season) => ({
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
    if (mapped.length !== 1) return mapped;
    return mapped.map((season) => {
        const providerSeasonNumber = getVodSeriesSeasonNumber(season, mapped);
        const seasonNumber = resolveEnrichmentSeasonNumber({
            rawTitle,
            providerSeasonNumber,
            providerSeasonCount: mapped.length,
        });
        return seasonNumber === providerSeasonNumber
            ? season
            : {
                  ...season,
                  season_number: String(seasonNumber),
                  providerSeasonKey: getVodSeriesSeasonKey(season),
                  providerSeasonNumber,
              };
    });
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
    options: MapVodSeriesEpisodesOptions
): Record<string, XtreamSerieEpisode[]> {
    const mapped: Record<string, XtreamSerieEpisode[]> = {};

    seasons.forEach((season) => {
        const seasonKey = season.season_number || season.name || season.id;
        const trackingSeasonKey = season.providerSeasonKey ?? seasonKey;
        const seasonNum = getVodSeriesSeasonNumber(season, seasons);

        mapped[seasonKey] = (season.episodes ?? []).map((episode) => {
            const episodeNum =
                toEpisodeNumber(episode.series_number) ||
                toEpisodeNumber(episode.episode_num);
            const providerEpisodeId = String(episode.id ?? '');
            const legacyTrackingId = generateLegacyVodEpisodeId(
                episodeNum,
                trackingSeasonKey
            );
            const trackingId = generateVodEpisodeId({
                parentSeriesId: options.parentSeriesId,
                providerEpisodeId,
                seasonKey: trackingSeasonKey,
                episodeNum,
            });

            return {
                ...createBaseEpisode(
                    trackingId,
                    episodeNum,
                    episode.name || `Episode ${episodeNum}`,
                    'mpg',
                    'vod-series',
                    seasonNum,
                    {
                        movie_image: episode.cover || options.fallbackPoster,
                        plot: episode.description || '',
                        duration: episode.duration
                            ? `${episode.duration} min`
                            : '',
                    }
                ),
                legacyTrackingId,
                ...(season.providerSeasonNumber !== undefined
                    ? { providerSeasonNumber: season.providerSeasonNumber }
                    : {}),
                originalId: providerEpisodeId,
            } as StalkerMappedEpisode;
        });
    });

    return mapped;
}

export function mapRegularSeriesEpisodes(
    seasons: ReadonlyArray<StalkerSeriesSeasonVm>,
    fallbackPoster?: string,
    rawTitle?: string | null
): Record<string, XtreamSerieEpisode[]> {
    const mapped: Record<string, XtreamSerieEpisode[]> = {};

    seasons.forEach((season, index) => {
        const seasonKey = String(
            resolveEnrichmentSeasonNumber({
                rawTitle,
                providerSeasonNumber: index + 1,
                providerSeasonCount: seasons.length,
            })
        );
        mapped[seasonKey] = (season.series ?? []).map((episodeNum) => {
            const trackingId = generateRegularEpisodeId(
                String(season.cmd ?? ''),
                episodeNum
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

export function getVodSeriesSeasonNumber(
    season: VodSeriesSeasonVm,
    seasons: ReadonlyArray<VodSeriesSeasonVm>
): number {
    const normalizedSeasonNumber = season.season_number.trim();
    const parsedSeasonNumber = Number(normalizedSeasonNumber);
    if (
        normalizedSeasonNumber !== '' &&
        Number.isInteger(parsedSeasonNumber) &&
        parsedSeasonNumber >= 0
    ) {
        return parsedSeasonNumber;
    }

    const orderedSeasons = [...seasons].sort((seasonA, seasonB) =>
        naturalSeasonCollator.compare(
            getVodSeriesSeasonKey(seasonA),
            getVodSeriesSeasonKey(seasonB)
        )
    );
    const seasonIndex = orderedSeasons.findIndex(
        (candidate) => candidate.id === season.id
    );
    return seasonIndex >= 0 ? seasonIndex + 1 : 1;
}
