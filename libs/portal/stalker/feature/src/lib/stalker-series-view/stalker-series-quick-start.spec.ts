import type { VodSeriesSeasonVm } from '@iptvnator/portal/stalker/data-access';
import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { getStalkerSeriesQuickStartButton } from './stalker-series-quick-start';

function season(
    seasonNumber: string,
    loadedEpisodes: number,
    episodesLoaded = loadedEpisodes > 0
): VodSeriesSeasonVm {
    return {
        id: `season-${seasonNumber}`,
        video_id: 'video-1',
        name: `Season ${seasonNumber}`,
        season_number: seasonNumber,
        episodes: Array.from(
            { length: loadedEpisodes },
            (_, index) => ({ id: `${seasonNumber}-${index + 1}` }) as never
        ),
        isLoading: false,
        isExpanded: false,
        episodesLoaded,
    };
}

/** Season `seasonNumber`'s mapped episodes, ids `seasonNumber * 100 + n`. */
function mapped(seasonNumber: number, count: number): XtreamSerieEpisode[] {
    return Array.from(
        { length: count },
        (_, index) =>
            ({
                id: String(seasonNumber * 100 + index + 1),
                episode_num: index + 1,
                title: `Episode ${index + 1}`,
                season: seasonNumber,
                container_extension: 'mpg',
                info: {},
                custom_sid: 'vod-series',
                added: '',
                direct_source: '',
            }) as XtreamSerieEpisode
    );
}

function watched(...ids: number[]): Map<number, PlaybackPositionData> {
    return new Map(
        ids.map((id, index) => [
            id,
            {
                contentXtreamId: id,
                contentType: 'episode',
                seriesXtreamId: 1,
                positionSeconds: 95,
                durationSeconds: 100,
                updatedAt: `2026-10-05T1${index}:00:00.000Z`,
            },
        ])
    );
}

describe('getStalkerSeriesQuickStartButton with extras (season 0)', () => {
    // Specials and season 2 not loaded yet; season 1 loaded.
    const seasons = [season('0', 0), season('1', 4), season('2', 0)];
    const mappedSeasons = { '0': [], '1': mapped(1, 4), '2': [] };

    it('plays the next regular episode without loading Specials first', () => {
        const button = getStalkerSeriesQuickStartButton({
            isVodSeries: true,
            mappedSeasons,
            playbackPositions: watched(101, 102, 103),
            vodSeriesSeasons: seasons,
        });

        expect(button?.lazySeason).toBeNull();
        expect(button?.action?.episode.id).toBe('104');
    });

    it('loads the next regular season, not Specials, once the loaded run is watched', () => {
        const button = getStalkerSeriesQuickStartButton({
            isVodSeries: true,
            mappedSeasons,
            playbackPositions: watched(101, 102, 103, 104),
            vodSeriesSeasons: seasons,
        });

        expect(button?.lazySeason?.season_number).toBe('2');
        expect(button?.episodeLabel).toBe('S02E01');
    });

    it('loads the first regular season, not Specials, when nothing is loaded', () => {
        const button = getStalkerSeriesQuickStartButton({
            isVodSeries: true,
            mappedSeasons: { '0': [], '1': [], '2': [] },
            playbackPositions: new Map(),
            vodSeriesSeasons: [season('0', 0), season('1', 0), season('2', 0)],
        });

        expect(button?.lazySeason?.season_number).toBe('1');
    });

    it('loads a season the portal has not answered for, not one that came back empty', () => {
        const button = getStalkerSeriesQuickStartButton({
            isVodSeries: true,
            mappedSeasons: { '0': [], '1': [], '2': [] },
            playbackPositions: new Map(),
            vodSeriesSeasons: [
                season('0', 0),
                season('1', 0, true),
                season('2', 0),
            ],
        });

        expect(button?.lazySeason?.season_number).toBe('2');
    });

    it('loads a pending regular season before playing or resuming an extra', () => {
        // The pinned season 1 failed or is in flight; Specials was opened.
        const onlyExtrasLoaded = {
            isVodSeries: true,
            mappedSeasons: { '0': mapped(0, 2), '1': [], '2': [] },
            vodSeriesSeasons: [season('0', 2), season('1', 0), season('2', 0)],
        };

        const play = getStalkerSeriesQuickStartButton({
            ...onlyExtrasLoaded,
            playbackPositions: new Map(),
        });
        const resume = getStalkerSeriesQuickStartButton({
            ...onlyExtrasLoaded,
            playbackPositions: new Map([
                [
                    1,
                    {
                        contentXtreamId: 1,
                        contentType: 'episode',
                        seriesXtreamId: 1,
                        positionSeconds: 40,
                        durationSeconds: 100,
                    },
                ],
            ]),
        });

        for (const button of [play, resume]) {
            expect(button?.lazySeason?.season_number).toBe('1');
            expect(button?.episodeLabel).toBe('S01E01');
        }
    });

    it('still loads Specials when every regular season came back empty', () => {
        const button = getStalkerSeriesQuickStartButton({
            isVodSeries: true,
            mappedSeasons: { '0': [], '1': [], '2': [] },
            playbackPositions: new Map(),
            vodSeriesSeasons: [
                season('0', 0),
                season('1', 0, true),
                season('2', 0, true),
            ],
        });

        expect(button?.lazySeason?.season_number).toBe('0');
    });
});
