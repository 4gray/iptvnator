import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { getSeriesNextUp, type SeriesNextUp } from './series-next-up';

function episode(
    id: number,
    season: number,
    episodeNum: number
): XtreamSerieEpisode {
    return {
        id: String(id),
        episode_num: episodeNum,
        title: `Episode ${episodeNum}`,
        container_extension: 'mp4',
        info: [],
        custom_sid: '',
        added: '',
        season,
        direct_source: '',
    };
}

/** Season `season`, episodes 1..count, ids `season * 100 + n`. */
function season(seasonNumber: number, count: number): XtreamSerieEpisode[] {
    return Array.from({ length: count }, (_, index) =>
        episode(seasonNumber * 100 + index + 1, seasonNumber, index + 1)
    );
}

const WATCHED = 95;
const STARTED = 40;

function position(
    contentXtreamId: number,
    positionSeconds: number,
    updatedAt?: string
): [number, PlaybackPositionData] {
    return [
        contentXtreamId,
        {
            contentXtreamId,
            contentType: 'episode',
            seriesXtreamId: 10,
            positionSeconds,
            durationSeconds: 100,
            ...(updatedAt ? { updatedAt } : {}),
        },
    ];
}

/** Watched in the order given, an hour apart. */
function watchedInOrder(...ids: number[]): [number, PlaybackPositionData][] {
    return ids.map((id, index) =>
        position(id, WATCHED, `2026-10-04T${10 + index}:00:00.000Z`)
    );
}

function nextUp(
    seasons: Record<string, XtreamSerieEpisode[]>,
    positions: [number, PlaybackPositionData][]
): SeriesNextUp | null {
    return getSeriesNextUp({
        seasons,
        playbackPositions: new Map(positions),
    });
}

/** The kind and the episode id it names. */
function summary(result: SeriesNextUp | null): [string, number] | null {
    if (!result) {
        return null;
    }
    const entry = result.kind === 'caught-up' ? result.skipped : result.entry;
    return [result.kind, Number(entry?.episode.id ?? 0)];
}

describe('getSeriesNextUp', () => {
    it('starts with the first episode when nothing has been played', () => {
        expect(summary(nextUp({ '1': season(1, 3) }, []))).toEqual([
            'start',
            101,
        ]);
    });

    it('goes on with the episode after the one watched last', () => {
        expect(
            summary(
                nextUp(
                    { '1': season(1, 5) },
                    watchedInOrder(101, 102, 103, 104)
                )
            )
        ).toEqual(['next', 105]);
    });

    it('goes on into the next season after a finale', () => {
        expect(
            summary(
                nextUp(
                    { '1': season(1, 2), '2': season(2, 2) },
                    watchedInOrder(101, 102)
                )
            )
        ).toEqual(['next', 201]);
    });

    it('goes on from a later season the user started with', () => {
        expect(
            summary(
                nextUp(
                    { '1': season(1, 3), '2': season(2, 3) },
                    watchedInOrder(201)
                )
            )
        ).toEqual(['next', 202]);
    });

    it('goes on past an episode the user skipped', () => {
        const seasons = { '1': season(1, 5) };

        expect(summary(nextUp(seasons, watchedInOrder(101, 102, 104)))).toEqual(
            ['next', 105]
        );

        // Caught up after the finale; the skipped episode is still named.
        const caughtUp = nextUp(seasons, watchedInOrder(101, 102, 104, 105));
        expect(summary(caughtUp)).toEqual(['caught-up', 103]);
        expect(caughtUp?.kind === 'caught-up' && caughtUp.last.episode.id).toBe(
            '105'
        );
    });

    it('goes on after the furthest episode when an earlier one is watched again', () => {
        expect(
            summary(
                nextUp(
                    { '1': season(1, 6) },
                    watchedInOrder(101, 102, 103, 104, 105, 102)
                )
            )
        ).toEqual(['next', 106]);
    });

    it('is caught up, with nothing skipped, once every episode is watched', () => {
        const result = nextUp({ '1': season(1, 2) }, watchedInOrder(101, 102));

        expect(summary(result)).toEqual(['caught-up', 0]);
    });

    describe('an episode left unfinished', () => {
        it('is resumed when it is the newest activity', () => {
            const result = nextUp({ '1': season(1, 4) }, [
                ...watchedInOrder(101),
                position(102, STARTED, '2026-10-04T12:00:00.000Z'),
            ]);

            expect(summary(result)).toEqual(['resume', 102]);
            expect(
                result?.kind === 'resume' && result.entry.position
            ).toMatchObject({ positionSeconds: STARTED });
        });

        it('is moved past once a later episode is watched after it', () => {
            expect(
                summary(
                    nextUp({ '1': season(1, 4) }, [
                        position(102, STARTED, '2026-10-04T09:00:00.000Z'),
                        ...watchedInOrder(101, 103),
                    ])
                )
            ).toEqual(['next', 104]);
        });

        it('comes next, with its position, when it follows the episode watched last', () => {
            const result = nextUp({ '1': season(1, 4) }, [
                position(102, STARTED, '2026-10-04T09:00:00.000Z'),
                ...watchedInOrder(101),
            ]);

            expect(summary(result)).toEqual(['next', 102]);
            expect(
                result?.kind === 'next' && result.entry.position
            ).toMatchObject({ positionSeconds: STARTED });
        });
    });

    describe('specials (season 0)', () => {
        const seasons = { '0': season(0, 2), '1': season(1, 3) };

        it('do not come next after an episode of the run', () => {
            expect(summary(nextUp(seasons, watchedInOrder(101)))).toEqual([
                'next',
                102,
            ]);
            expect(
                summary(nextUp(seasons, watchedInOrder(101, 102, 103)))
            ).toEqual(['caught-up', 0]);
        });

        it('come next after a special', () => {
            expect(summary(nextUp(seasons, watchedInOrder(1)))).toEqual([
                'next',
                2,
            ]);
            expect(summary(nextUp(seasons, watchedInOrder(1, 2)))).toEqual([
                'next',
                101,
            ]);
        });

        it('are recognised by the episode season when the key is not a number', () => {
            // "Specials" sorts after "1": the special follows the finale.
            const result = nextUp(
                { '1': season(1, 2), Specials: season(0, 1) },
                watchedInOrder(101, 102)
            );

            expect(summary(result)).toEqual(['caught-up', 0]);
            expect(result?.kind === 'caught-up' && result.last.special).toBe(
                true
            );
        });
    });

    it('orders saves without a time by series order', () => {
        expect(
            summary(
                nextUp({ '1': season(1, 3) }, [
                    position(101, STARTED),
                    position(102, STARTED),
                ])
            )
        ).toEqual(['resume', 102]);
    });

    it.each([
        ['a minute after', '2026-10-04T07:59:00.000Z', 'next', 103],
        ['a minute before', '2026-10-04T08:01:00.000Z', 'resume', 103],
    ])(
        'reads SQLite times as UTC: a database row saved %s a renderer row',
        (_, isoTime, kind, id) => {
            // The database writes CURRENT_TIMESTAMP (UTC, no zone); a row
            // the page just saved carries an ISO time.
            const result = nextUp({ '1': season(1, 4) }, [
                position(101, WATCHED, '2026-10-03 08:00:00'),
                position(102, WATCHED, '2026-10-04 08:00:00'),
                position(103, STARTED, isoTime),
            ]);

            expect(summary(result)).toEqual([kind, id]);
        }
    );

    it('has nothing to go on with when no season lists an episode', () => {
        expect(nextUp({ '1': [] }, [])).toBeNull();
    });
});
