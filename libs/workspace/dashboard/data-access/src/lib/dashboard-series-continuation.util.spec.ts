import type {
    PlaybackPositionData,
    PortalRecentItem,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT,
    CONTINUE_WATCHING_VISIBLE_ITEMS,
    planDashboardSeriesLookups,
    resolveDashboardSeriesContinuation,
    selectSeriesContinuationCandidates,
    type DashboardSeriesCandidate,
} from './dashboard-series-continuation.util';
import type { DashboardSeriesEpisodes } from './dashboard-series-episodes.service';

const PLAYLIST = 'xtream-1';
const SERIES = 900;

function episode(
    id: number,
    season: number | undefined,
    episodeNum: number
): XtreamSerieEpisode {
    return {
        id: String(id),
        season,
        episode_num: episodeNum,
        title: `Episode ${episodeNum}`,
    } as XtreamSerieEpisode;
}

function row(
    contentXtreamId: number,
    positionSeconds: number,
    updatedAt = '2026-10-04 08:00:00'
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'episode',
        seriesXtreamId: SERIES,
        seasonNumber: 1,
        episodeNumber: contentXtreamId % 10,
        positionSeconds,
        durationSeconds: 3552,
        playlistId: PLAYLIST,
        updatedAt,
    };
}

const loaded = (
    seasons: Record<string, XtreamSerieEpisode[]>
): DashboardSeriesEpisodes => ({ status: 'loaded', seasons });

// Watched: stopped with only the credits left.
const WATCHED = 3491;

function candidate(newest: PlaybackPositionData): DashboardSeriesCandidate {
    return {
        item: {
            id: 1,
            title: 'The Penguin',
            type: 'series',
            source: 'xtream',
            playlist_id: PLAYLIST,
            xtream_id: SERIES,
            viewed_at: '2026-10-04',
        } as PortalRecentItem,
        seriesXtreamId: SERIES,
        newest,
    };
}

describe('resolveDashboardSeriesContinuation', () => {
    const season1 = [
        episode(1, 1, 1),
        episode(2, 1, 2),
        episode(3, 1, 3),
        episode(4, 1, 4),
        episode(5, 1, 5),
    ];

    it('goes on with the next episode once the newest one is watched', () => {
        const rows = [1, 2, 3, 4].map((id) => row(id, WATCHED));

        expect(
            resolveDashboardSeriesContinuation(
                candidate(rows[3]),
                rows,
                loaded({ '1': season1 })
            )
        ).toEqual({
            kind: 'continue',
            position: {
                contentXtreamId: 5,
                contentType: 'episode',
                seriesXtreamId: SERIES,
                seasonNumber: 1,
                episodeNumber: 5,
                positionSeconds: 0,
                playlistId: PLAYLIST,
                updatedAt: rows[3].updatedAt,
            },
        });
    });

    it('goes on with the next season after a season finale', () => {
        const rows = [1, 2].map((id) => row(id, WATCHED));

        const continuation = resolveDashboardSeriesContinuation(
            candidate(rows[1]),
            rows,
            loaded({
                '1': [episode(1, 1, 1), episode(2, 1, 2)],
                '2': [episode(21, 2, 1), episode(22, 2, 2)],
            })
        );

        expect(continuation).toMatchObject({
            kind: 'continue',
            position: {
                contentXtreamId: 21,
                seasonNumber: 2,
                episodeNumber: 1,
            },
        });
    });

    it('is finished once every episode is watched', () => {
        const rows = [1, 2, 3, 4, 5].map((id) => row(id, WATCHED));

        expect(
            resolveDashboardSeriesContinuation(
                candidate(rows[4]),
                rows,
                loaded({ '1': season1 })
            )
        ).toEqual({ kind: 'finished' });
    });

    it('moves past an episode left unfinished before the newest watched one', () => {
        const rows = [
            row(1, WATCHED, '2026-10-01 08:00:00'),
            row(2, 1200, '2026-10-02 08:00:00'),
            row(3, WATCHED, '2026-10-03 08:00:00'),
        ];

        expect(
            resolveDashboardSeriesContinuation(
                candidate(rows[2]),
                rows,
                loaded({ '1': season1 })
            )
        ).toMatchObject({
            kind: 'continue',
            position: { contentXtreamId: 4, positionSeconds: 0 },
        });
    });

    it('resumes the next episode where it was left', () => {
        const unfinished = row(2, 1200, '2026-10-01 08:00:00');
        // Episode 1 watched again after episode 2 was left.
        const rows = [row(1, WATCHED, '2026-10-03 08:00:00'), unfinished];

        expect(
            resolveDashboardSeriesContinuation(
                candidate(rows[0]),
                rows,
                loaded({ '1': season1 })
            )
        ).toEqual({ kind: 'continue', position: unfinished });
    });

    it('goes on from a later season the user started with', () => {
        const rows = [row(21, WATCHED)];

        expect(
            resolveDashboardSeriesContinuation(
                candidate(rows[0]),
                rows,
                loaded({
                    '1': [episode(1, 1, 1), episode(2, 1, 2)],
                    '2': [episode(21, 2, 1), episode(22, 2, 2)],
                })
            )
        ).toMatchObject({
            kind: 'continue',
            position: { contentXtreamId: 22, seasonNumber: 2 },
        });
    });

    it('goes on past a skipped episode and is finished after the finale', () => {
        const rows = [1, 2, 4].map((id) =>
            row(id, WATCHED, `2026-10-0${id} 08:00:00`)
        );
        const resolve = (watched: PlaybackPositionData[]) =>
            resolveDashboardSeriesContinuation(
                candidate(watched[watched.length - 1]),
                watched,
                loaded({ '1': season1 })
            );

        expect(resolve(rows)).toMatchObject({
            kind: 'continue',
            position: { contentXtreamId: 5 },
        });
        expect(
            resolve([...rows, row(5, WATCHED, '2026-10-05 08:00:00')])
        ).toEqual({ kind: 'finished' });
    });

    it('does not lead into the specials of season 0', () => {
        const rows = [row(2, WATCHED)];

        expect(
            resolveDashboardSeriesContinuation(
                candidate(rows[0]),
                rows,
                loaded({
                    '0': [episode(91, 0, 1)],
                    '1': [episode(1, 1, 1), episode(2, 1, 2)],
                })
            )
        ).toEqual({ kind: 'finished' });
    });

    describe('with extras (season 0)', () => {
        const seasons = loaded({
            '0': [episode(91, 0, 1), episode(92, 0, 2)],
            '1': season1,
        });
        const extra = (positionSeconds: number): PlaybackPositionData => ({
            ...row(91, positionSeconds, '2026-10-02 08:00:00'),
            seasonNumber: 0,
            episodeNumber: 1,
        });

        it('goes back to the run after an extra, watched or left unfinished', () => {
            const watchedRun = row(1, WATCHED, '2026-10-01 08:00:00');

            for (const newest of [extra(WATCHED), extra(1200)]) {
                expect(
                    resolveDashboardSeriesContinuation(
                        candidate(newest),
                        [watchedRun, newest],
                        seasons
                    )
                ).toMatchObject({
                    kind: 'continue',
                    position: {
                        contentXtreamId: 2,
                        seasonNumber: 1,
                        episodeNumber: 2,
                        positionSeconds: 0,
                    },
                });
            }
        });

        it('starts the run when only an extra was played', () => {
            const newest = extra(WATCHED);

            expect(
                resolveDashboardSeriesContinuation(
                    candidate(newest),
                    [newest],
                    seasons
                )
            ).toMatchObject({
                kind: 'continue',
                position: { contentXtreamId: 1, seasonNumber: 1 },
            });
        });

        it('is finished after the finale, extras left or not', () => {
            const rows = [1, 2, 3, 4, 5].map((id) =>
                row(id, WATCHED, `2026-10-0${id} 08:00:00`)
            );

            expect(
                resolveDashboardSeriesContinuation(
                    candidate(rows[4]),
                    rows,
                    seasons
                )
            ).toEqual({ kind: 'finished' });
        });
    });

    it('takes the season from the episode list when an episode lacks one', () => {
        const rows = [row(1, WATCHED)];

        expect(
            resolveDashboardSeriesContinuation(
                candidate(rows[0]),
                rows,
                loaded({
                    '3': [episode(1, undefined, 1), episode(2, undefined, 2)],
                })
            )
        ).toMatchObject({
            kind: 'continue',
            position: { contentXtreamId: 2, seasonNumber: 3, episodeNumber: 2 },
        });
    });

    it('does not know while the episode list is missing, empty or malformed', () => {
        const rows = [row(4, WATCHED)];
        const resolve = (episodes: DashboardSeriesEpisodes | null) =>
            resolveDashboardSeriesContinuation(
                candidate(rows[0]),
                rows,
                episodes
            );

        expect(resolve(null)).toEqual({ kind: 'unknown' });
        expect(resolve({ status: 'loading' })).toEqual({ kind: 'unknown' });
        expect(resolve({ status: 'failed' })).toEqual({ kind: 'unknown' });
        expect(resolve(loaded({}))).toEqual({ kind: 'unknown' });
        // The list does not hold the episode played (renumbered ids).
        expect(
            resolve(loaded({ '1': [episode(7, 1, 1), episode(8, 1, 2)] }))
        ).toEqual({ kind: 'unknown' });
        expect(
            resolve(
                loaded({ '1': 'not a list' } as unknown as Record<
                    string,
                    XtreamSerieEpisode[]
                >)
            )
        ).toEqual({ kind: 'unknown' });
        expect(
            resolve(
                loaded({
                    '1': [episode(4, 1, 4), { ...episode(5, 1, 5), id: 'x5' }],
                })
            )
        ).toEqual({ kind: 'unknown' });
    });
});

describe('selectSeriesContinuationCandidates', () => {
    const item = (
        id: number,
        overrides: Partial<PortalRecentItem> = {}
    ): PortalRecentItem =>
        ({
            id,
            title: `Title ${id}`,
            type: 'series',
            source: 'xtream',
            playlist_id: PLAYLIST,
            xtream_id: id,
            viewed_at: '2026-10-04',
            ...overrides,
        }) as PortalRecentItem;

    it('keeps Xtream series whose newest episode is watched or an extra, newest first', () => {
        const positions = new Map<number, PlaybackPositionData | null>([
            [1, row(11, WATCHED)],
            // In progress: it simply continues.
            [2, row(12, 600)],
            [3, row(13, WATCHED)],
            // A movie leaves on its own once watched.
            [4, { ...row(14, WATCHED), contentType: 'vod' }],
            // Stalker episode lists cannot be looked up.
            [5, row(15, WATCHED)],
            // Without its series id there is nothing to look up.
            [6, { ...row(16, WATCHED), seriesXtreamId: undefined }],
            [7, null],
            // An extra, even unfinished: it never takes the series' place.
            [8, { ...row(18, 600), seasonNumber: 0 }],
        ]);
        const items = [
            item(1),
            item(2),
            item(3),
            item(4, { type: 'movie' }),
            item(5, { source: 'stalker' }),
            item(6),
            item(7),
            item(8),
        ];

        const candidates = selectSeriesContinuationCandidates(
            items,
            (recent) => positions.get(recent.id as number) ?? null
        );

        expect(candidates.map((c) => [c.item.id, c.seriesXtreamId])).toEqual([
            [1, SERIES],
            [3, SERIES],
            [8, SERIES],
        ]);
    });
});

describe('planDashboardSeriesLookups', () => {
    const recent = (id: number, type: 'movie' | 'series'): PortalRecentItem =>
        ({
            id,
            title: `Title ${id}`,
            type,
            source: 'xtream',
            playlist_id: PLAYLIST,
            xtream_id: id,
            viewed_at: '2026-10-04',
        }) as PortalRecentItem;
    const asCandidate = (item: PortalRecentItem): DashboardSeriesCandidate => ({
        item,
        seriesXtreamId: item.xtream_id as number,
        newest: row(1, WATCHED),
    });
    const plan = (
        items: PortalRecentItem[],
        finished: (candidate: DashboardSeriesCandidate) => boolean
    ) =>
        planDashboardSeriesLookups({
            items,
            candidates: items
                .filter((item) => item.type === 'series')
                .map(asCandidate),
            listedWithoutLookup: () => true,
            resolve: (candidate) =>
                finished(candidate)
                    ? { kind: 'finished' }
                    : { kind: 'unknown' },
        });
    const ids = (list: readonly DashboardSeriesCandidate[]) =>
        list.map((candidate) => candidate.item.id);

    it("stops once the rail's titles are listed, counting titles that need no lookup", () => {
        const movies = Array.from(
            { length: CONTINUE_WATCHING_VISIBLE_ITEMS - 2 },
            (_, i) => recent(i + 1, 'movie')
        );
        const series = [101, 102, 103].map((id) => recent(id, 'series'));

        const result = plan([...movies, ...series], () => false);

        expect(ids(result.window)).toEqual([101, 102]);
        expect(result.continuations.has(`${PLAYLIST}::series::103`)).toBe(
            false
        );
    });

    it('looks past finished series for the next one', () => {
        const series = Array.from(
            { length: CONTINUE_WATCHING_VISIBLE_ITEMS + 1 },
            (_, i) => recent(i + 1, 'series')
        );

        const result = plan(
            series,
            (candidate) =>
                (candidate.item.id as number) <= CONTINUE_WATCHING_VISIBLE_ITEMS
        );

        expect(result.window).toHaveLength(series.length);
    });

    it(`looks up ${CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT} series at most`, () => {
        const series = Array.from(
            { length: CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT + 1 },
            (_, i) => recent(i + 1, 'series')
        );

        const result = plan(series, () => true);

        expect(result.window).toHaveLength(
            CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT
        );
        expect(result.continuations.size).toBe(
            CONTINUE_WATCHING_SERIES_LOOKUP_LIMIT
        );
    });
});
