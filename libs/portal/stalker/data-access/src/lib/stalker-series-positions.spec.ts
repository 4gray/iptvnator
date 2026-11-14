import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { StalkerMappedEpisode } from './stalker-series.adapters';
import { reconcileStalkerSeriesPositions } from './stalker-series-positions';

describe('reconcileStalkerSeriesPositions', () => {
    const episode = (
        overrides: Partial<StalkerMappedEpisode> = {}
    ): StalkerMappedEpisode => ({
        id: '101',
        legacyTrackingId: 11,
        season: 2,
        episode_num: 3,
        title: 'Synthetic episode',
        container_extension: 'mpg',
        custom_sid: '',
        added: '',
        direct_source: '',
        info: {},
        ...overrides,
    });
    const position = (
        overrides: Partial<PlaybackPositionData> = {}
    ): PlaybackPositionData => ({
        contentType: 'episode',
        contentXtreamId: 11,
        seriesXtreamId: 42,
        seasonNumber: 2,
        episodeNumber: 3,
        positionSeconds: 120,
        durationSeconds: 900,
        playlistId: 'synthetic-portal',
        ...overrides,
    });
    const reconcile = (
        positions: PlaybackPositionData[],
        episodes = [episode()]
    ) =>
        reconcileStalkerSeriesPositions({
            seriesXtreamId: 42,
            episodesBySeason: { '2': episodes },
            seriesPositions: positions,
        });

    it('projects legacy progress onto the scoped identity without mutating its stored row', () => {
        const legacy = position({
            watched: true,
            activitySessionId: 'synthetic-session',
        });
        const before = { ...legacy };
        const result = reconcile([legacy]);
        expect(result.positionsByTrackingId.get(101)).toEqual({
            ...legacy,
            contentXtreamId: 101,
        });
        expect(result.positionsByTrackingId.get(101)).not.toBe(legacy);
        expect(result.legacyPositionByTrackingId.get(101)).toBe(legacy);
        expect(legacy).toEqual(before);
    });

    it('prefers exact scoped progress while retaining a compatible legacy row for cleanup', () => {
        const exact = position({ contentXtreamId: 101, positionSeconds: 400 });
        const legacy = position({ positionSeconds: 800 });
        const result = reconcile([exact, legacy]);
        expect(result.positionsByTrackingId.get(101)).toBe(exact);
        expect(result.legacyPositionByTrackingId.get(101)).toBe(legacy);
    });

    it('does not reuse another series or a movie position with a colliding tracking ID', () => {
        const result = reconcile([
            position({ seriesXtreamId: 43 }),
            position({ seriesXtreamId: 43, contentXtreamId: 101 }),
            position({ contentType: 'vod' }),
            position({ contentType: 'vod', contentXtreamId: 101 }),
        ]);
        expect(result.positionsByTrackingId.size).toBe(0);
        expect(result.legacyPositionByTrackingId.size).toBe(0);
    });

    it.each([
        { seasonNumber: 4 },
        { episodeNumber: 4 },
        { seasonNumber: 1, episodeNumber: 4 },
    ])(
        'rejects incompatible legacy coordinates %j without displacing an exact position',
        (coordinates) => {
            const exact = position({ contentXtreamId: 101 });
            const result = reconcile(
                [exact, position(coordinates)],
                [episode({ providerSeasonNumber: 1 })]
            );
            expect(result.positionsByTrackingId.get(101)).toBe(exact);
            expect(result.legacyPositionByTrackingId.size).toBe(0);
        }
    );

    it('accepts pre-correction provider-season progress but writes display coordinates into the projection', () => {
        const legacy = position({ seasonNumber: 1 });
        const result = reconcile(
            [legacy],
            [episode({ providerSeasonNumber: 1 })]
        );
        expect(result.positionsByTrackingId.get(101)).toMatchObject({
            contentXtreamId: 101,
            seriesXtreamId: 42,
            seasonNumber: 2,
            episodeNumber: 3,
            positionSeconds: 120,
        });
        expect(result.legacyPositionByTrackingId.get(101)).toBe(legacy);
        expect(legacy.seasonNumber).toBe(1);
    });

    it('supports historical rows without optional season and episode metadata', () => {
        const result = reconcile([
            position({ seasonNumber: undefined, episodeNumber: undefined }),
        ]);
        expect(result.positionsByTrackingId.get(101)).toMatchObject({
            seasonNumber: 2,
            episodeNumber: 3,
            contentXtreamId: 101,
        });
        expect(result.legacyPositionByTrackingId.size).toBe(1);
    });

    it('skips invalid tracking IDs and never treats a scoped ID as its own legacy alias', () => {
        const exact = position({ contentXtreamId: 101 });
        const result = reconcile(
            [exact, position()],
            [
                episode({ id: 'not-numeric' }),
                episode({ id: 'Infinity' }),
                episode({ legacyTrackingId: 101 }),
                episode({ id: '102', legacyTrackingId: undefined }),
                episode({ id: '103', legacyTrackingId: 999 }),
            ]
        );
        expect([...result.positionsByTrackingId.entries()]).toEqual([
            [101, exact],
        ]);
        expect(result.legacyPositionByTrackingId.size).toBe(0);
    });

    it('reconciles every season independently when legacy IDs have matching coordinates', () => {
        const secondSeason = position();
        const thirdSeason = position({
            contentXtreamId: 12,
            seasonNumber: 3,
            episodeNumber: 1,
        });
        const result = reconcileStalkerSeriesPositions({
            seriesXtreamId: 42,
            episodesBySeason: {
                '2': [episode()],
                '3': [
                    episode({
                        id: '102',
                        legacyTrackingId: 12,
                        season: 3,
                        episode_num: 1,
                    }),
                ],
            },
            seriesPositions: [secondSeason, thirdSeason],
        });
        expect([...result.positionsByTrackingId.keys()]).toEqual([101, 102]);
        expect(result.positionsByTrackingId.get(102)).toEqual({
            ...thirdSeason,
            contentXtreamId: 102,
        });
    });
});
