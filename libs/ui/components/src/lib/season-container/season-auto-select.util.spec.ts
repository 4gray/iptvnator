import {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import {
    type AutoSeasonContext,
    resolveAutoSelectedSeason,
} from './season-auto-select.util';

// Direct coverage for the pure season auto-select rule. The container specs
// exercise it through the component; this file pins each branch on its own.

function episode(id: string, season: number): XtreamSerieEpisode {
    return {
        id,
        episode_num: 1,
        title: `Episode ${id}`,
        container_extension: 'mp4',
        info: {},
        custom_sid: '',
        added: '',
        season,
        direct_source: '',
    } as XtreamSerieEpisode;
}

function position(
    contentXtreamId: number,
    overrides: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'episode',
        positionSeconds: 600,
        durationSeconds: 2700,
        ...overrides,
    };
}

const inProgress = (contentXtreamId: number, updatedAt?: string) =>
    position(contentXtreamId, { positionSeconds: 600, updatedAt });
const watched = (contentXtreamId: number) =>
    position(contentXtreamId, { positionSeconds: 2700 });

/**
 * Builds the context the container would hand over: one episode per listed
 * id, season keys in display order, counts derived from the same data.
 */
function context(
    seasons: Record<string, string[]>,
    positions: Record<string, PlaybackPositionData> = {},
    overrides: Partial<AutoSeasonContext> = {}
): AutoSeasonContext {
    const keys = Object.keys(seasons).sort((a, b) => Number(a) - Number(b));
    const episodes: Record<string, XtreamSerieEpisode[]> = {};
    const episodeCounts: Record<string, number> = {};
    const watchedCounts: Record<string, number> = {};
    for (const key of keys) {
        episodes[key] = seasons[key].map((id) => episode(id, Number(key)));
        episodeCounts[key] = seasons[key].length;
        watchedCounts[key] = seasons[key].filter((id) => {
            const stored = positions[id];
            return (
                stored !== undefined &&
                stored.positionSeconds / (stored.durationSeconds ?? 1) >= 0.9
            );
        }).length;
    }
    return {
        keys,
        playingSeasonKey: null,
        seasons: episodes,
        positionOf: (item) => positions[item.id],
        hasUnloadedSeasons: false,
        episodeCounts,
        watchedCounts,
        ...overrides,
    };
}

describe('resolveAutoSelectedSeason', () => {
    it('returns undefined without season keys', () => {
        expect(resolveAutoSelectedSeason(context({}))).toBeUndefined();
        expect(
            resolveAutoSelectedSeason(
                context({}, {}, { playingSeasonKey: '3' })
            )
        ).toBeUndefined();
    });

    it('prefers the playing season over every other rule', () => {
        const ctx = context(
            { '1': ['101'], '2': ['201'], '3': ['301'] },
            { '201': inProgress(201, '2026-07-02T00:00:00.000Z') },
            { playingSeasonKey: '3' }
        );
        expect(resolveAutoSelectedSeason(ctx)).toBe('3');
    });

    it('picks the most recently updated in-progress season', () => {
        const ctx = context(
            { '1': ['101', '102'], '2': ['201'], '3': ['301'] },
            {
                '101': inProgress(101, '2026-07-03T00:00:00.000Z'),
                '301': inProgress(301, '2026-07-01T00:00:00.000Z'),
            }
        );
        // Season three is later in display order but its resume point is
        // older; recency, not position, decides.
        expect(resolveAutoSelectedSeason(ctx)).toBe('1');
    });

    it('treats a missing updatedAt as the oldest resume point', () => {
        const ctx = context(
            { '1': ['101'], '2': ['201'] },
            {
                '101': inProgress(101, '2026-07-01T00:00:00.000Z'),
                '201': inProgress(201),
            }
        );
        expect(resolveAutoSelectedSeason(ctx)).toBe('1');
    });

    it('resolves an updatedAt tie to the season scanned last', () => {
        const ctx = context(
            { '1': ['101'], '2': ['201'] },
            {
                '101': inProgress(101, '2026-07-01T00:00:00.000Z'),
                '201': inProgress(201, '2026-07-01T00:00:00.000Z'),
            }
        );
        // `>=` keeps the later entry on a tie: the scan order of the seasons
        // map, which follows the container's sorted keys.
        expect(resolveAutoSelectedSeason(ctx)).toBe('2');
    });

    it('ignores watched and barely-started positions when looking for progress', () => {
        const ctx = context(
            { '1': ['101'], '2': ['201'], '3': ['301'] },
            {
                '101': watched(101),
                '301': position(301, {
                    positionSeconds: 5,
                    updatedAt: '2026-07-09T00:00:00.000Z',
                }),
            }
        );
        // Season one is watched, season three's 5 s is below the in-progress
        // threshold, so the default rule runs: earliest unwatched season.
        expect(resolveAutoSelectedSeason(ctx)).toBe('2');
    });

    it('falls back to the earliest season with unwatched episodes', () => {
        const ctx = context(
            { '1': ['101', '102'], '2': ['201'], '3': ['301'] },
            { '101': watched(101), '102': watched(102) }
        );
        expect(resolveAutoSelectedSeason(ctx)).toBe('2');
    });

    it('opens the latest non-empty season once everything is watched', () => {
        const ctx = context(
            { '1': ['101'], '2': ['201'], '3': ['301'] },
            { '101': watched(101), '201': watched(201), '301': watched(301) }
        );
        expect(resolveAutoSelectedSeason(ctx)).toBe('3');
    });

    it('skips loaded-but-empty seasons in both fallback branches', () => {
        // An empty season is never "unwatched": the first season with
        // episodes wins.
        expect(
            resolveAutoSelectedSeason(
                context({ '1': [], '2': ['201'], '3': ['301'] })
            )
        ).toBe('2');
        // Nor is it the "latest" season once everything is watched.
        expect(
            resolveAutoSelectedSeason(
                context(
                    { '1': ['101'], '2': ['201'], '3': [] },
                    { '101': watched(101), '201': watched(201) }
                )
            )
        ).toBe('2');
    });

    it('returns the first key when every season is empty', () => {
        expect(resolveAutoSelectedSeason(context({ '1': [], '2': [] }))).toBe(
            '1'
        );
    });

    it('pins the first key while seasons are still unloaded', () => {
        const ctx = context(
            { '1': ['101'], '2': ['201'], '3': [] },
            { '101': watched(101) },
            { hasUnloadedSeasons: true }
        );
        // Watched state of the unloaded seasons is unknown, so the fallback
        // does not skip ahead — but a resume point still outranks the pin.
        expect(resolveAutoSelectedSeason(ctx)).toBe('1');
        expect(
            resolveAutoSelectedSeason(
                context(
                    { '1': ['101'], '2': ['201'], '3': [] },
                    { '201': inProgress(201, '2026-07-01T00:00:00.000Z') },
                    { hasUnloadedSeasons: true }
                )
            )
        ).toBe('2');
    });
});
