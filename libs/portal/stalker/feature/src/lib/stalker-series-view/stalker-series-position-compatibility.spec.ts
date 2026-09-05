import type {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import type { StalkerMappedEpisode } from '@iptvnator/portal/stalker/data-access';
import {
    clearStalkerSeriesPosition,
    reconcileStalkerSeriesPositions,
    saveStalkerSeriesPosition,
    StalkerSeriesPositionPartialSaveError,
} from './stalker-series-position-compatibility';

const PLAYLIST_ID = 'playlist-1';
const SERIES_ID = 100;
const FOREIGN_SERIES_ID = 200;
const SCOPED_TRACKING_ID = 1001;
const LEGACY_TRACKING_ID = 501;

interface EpisodeOptions {
    trackingId?: number;
    legacyTrackingId?: number;
    seasonNumber?: number;
    episodeNumber?: number;
}

interface RejectedOwnershipCase {
    name: string;
    position: PlaybackPositionData;
    legacyPosition?: PlaybackPositionData;
}

function createEpisode(options: EpisodeOptions = {}): StalkerMappedEpisode {
    const episodeNumber = options.episodeNumber ?? 2;
    return {
        id: String(options.trackingId ?? SCOPED_TRACKING_ID),
        episode_num: episodeNumber,
        title: `Episode ${episodeNumber}`,
        container_extension: 'mpg',
        info: {},
        custom_sid: 'vod-series',
        added: '',
        season: options.seasonNumber ?? 1,
        direct_source: '',
        legacyTrackingId: options.legacyTrackingId,
        originalId: `provider-${episodeNumber}`,
    };
}

function createPosition(
    overrides: Partial<PlaybackPositionData> = {}
): PlaybackPositionData {
    return {
        contentXtreamId: SCOPED_TRACKING_ID,
        contentType: 'episode',
        seriesXtreamId: SERIES_ID,
        seasonNumber: 1,
        episodeNumber: 2,
        positionSeconds: 45,
        durationSeconds: 120,
        playlistId: PLAYLIST_ID,
        ...overrides,
    };
}

function reconcile(
    episodes: readonly XtreamSerieEpisode[],
    seriesPositions: readonly PlaybackPositionData[],
    seriesXtreamId = SERIES_ID
) {
    return reconcileStalkerSeriesPositions({
        seriesXtreamId,
        episodesBySeason: { '1': episodes },
        seriesPositions,
    });
}

describe('stalker series position compatibility', () => {
    it('retains pre-correction legacy progress only for the original provider season', () => {
        const episode = {
            ...createEpisode({
                legacyTrackingId: LEGACY_TRACKING_ID,
                seasonNumber: 2,
            }),
            providerSeasonNumber: 1,
        };
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
        });
        const result = reconcile([episode], [legacyPosition]);
        expect(result.positionsByTrackingId.get(SCOPED_TRACKING_ID)).toEqual({
            ...legacyPosition,
            contentXtreamId: SCOPED_TRACKING_ID,
            seasonNumber: 2,
        });
        expect(result.legacyPositionByTrackingId.get(SCOPED_TRACKING_ID)).toBe(
            legacyPosition
        );
        expect(
            reconcile([episode], [{ ...legacyPosition, seasonNumber: 3 }])
                .positionsByTrackingId.size
        ).toBe(0);
        expect(
            reconcile([episode], [{ ...legacyPosition, episodeNumber: 3 }])
                .positionsByTrackingId.size
        ).toBe(0);
    });

    it('prefers an exact scoped row while retaining compatible legacy cleanup metadata', () => {
        const episode = createEpisode({
            legacyTrackingId: LEGACY_TRACKING_ID,
        });
        const exactPosition = createPosition({ positionSeconds: 90 });
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            positionSeconds: 30,
        });

        const result = reconcile(
            [episode],
            [legacyPosition, exactPosition]
        );

        expect(result.positionsByTrackingId.get(SCOPED_TRACKING_ID)).toBe(
            exactPosition
        );
        expect(
            result.legacyPositionByTrackingId.get(SCOPED_TRACKING_ID)
        ).toBe(legacyPosition);
        expect(
            result.positionsByTrackingId.has(LEGACY_TRACKING_ID)
        ).toBe(false);
    });

    it('aliases only the current parent legacy row under the scoped ID without mutating it', () => {
        const episode = createEpisode({
            legacyTrackingId: LEGACY_TRACKING_ID,
        });
        const currentParentLegacy = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            seasonNumber: undefined,
            episodeNumber: undefined,
        });
        const foreignParentLegacy = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            seriesXtreamId: FOREIGN_SERIES_ID,
            positionSeconds: 99,
        });

        const result = reconcile(
            [episode],
            [foreignParentLegacy, currentParentLegacy]
        );
        const migrated = result.positionsByTrackingId.get(SCOPED_TRACKING_ID);

        expect(migrated).toEqual({
            ...currentParentLegacy,
            contentXtreamId: SCOPED_TRACKING_ID,
            seriesXtreamId: SERIES_ID,
            seasonNumber: 1,
            episodeNumber: 2,
        });
        expect(migrated).not.toBe(currentParentLegacy);
        expect(currentParentLegacy.contentXtreamId).toBe(LEGACY_TRACKING_ID);
        expect(
            result.legacyPositionByTrackingId.get(SCOPED_TRACKING_ID)
        ).toBe(currentParentLegacy);

        const foreignResult = reconcile(
            [episode],
            [foreignParentLegacy],
            SERIES_ID
        );
        expect(foreignResult.positionsByTrackingId.size).toBe(0);
        expect(foreignResult.legacyPositionByTrackingId.size).toBe(0);
    });

    it('matches present coordinates numerically and treats nullish coordinates as absent', () => {
        const episode = createEpisode({
            legacyTrackingId: LEGACY_TRACKING_ID,
        });
        const numericStringCoordinates = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            seasonNumber: '1' as unknown as number,
            episodeNumber: '2' as unknown as number,
        });
        const absentCoordinates = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            seasonNumber: null as unknown as number,
            episodeNumber: undefined,
        });

        expect(
            reconcile(
                [episode],
                [numericStringCoordinates]
            ).positionsByTrackingId.has(SCOPED_TRACKING_ID)
        ).toBe(true);
        expect(
            reconcile(
                [episode],
                [absentCoordinates]
            ).positionsByTrackingId.has(SCOPED_TRACKING_ID)
        ).toBe(true);
    });

    it('rejects a legacy alias when either present coordinate conflicts', () => {
        const episode = createEpisode({
            legacyTrackingId: LEGACY_TRACKING_ID,
        });
        const wrongSeason = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            seasonNumber: 3,
        });
        const wrongEpisode = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            episodeNumber: 8,
        });

        for (const position of [wrongSeason, wrongEpisode]) {
            const result = reconcile([episode], [position]);
            expect(result.positionsByTrackingId.size).toBe(0);
            expect(result.legacyPositionByTrackingId.size).toBe(0);
        }
    });

    it('never aliases an episode without legacy tracking metadata', () => {
        const episode = createEpisode();
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
        });

        const result = reconcile([episode], [legacyPosition]);

        expect(result.positionsByTrackingId.size).toBe(0);
        expect(result.legacyPositionByTrackingId.size).toBe(0);
    });

    it('awaits a scoped save before clearing the confirmed legacy row', async () => {
        const order: string[] = [];
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
        });
        const position = reconcile(
            [
                createEpisode({
                    legacyTrackingId: LEGACY_TRACKING_ID,
                }),
            ],
            [legacyPosition]
        ).positionsByTrackingId.get(SCOPED_TRACKING_ID);
        expect(position).toBeDefined();
        if (!position) {
            throw new Error('Expected a migrated scoped position');
        }
        const repository = {
            savePlaybackPosition: jest.fn(
                async (_playlistId: string, saved: PlaybackPositionData) => {
                    order.push(`save:${saved.contentXtreamId}`);
                }
            ),
            clearPlaybackPosition: jest.fn(
                async (
                    _playlistId: string,
                    contentXtreamId: number
                ) => {
                    order.push(`clear:${contentXtreamId}`);
                }
            ),
        };

        await expect(
            saveStalkerSeriesPosition({
                repository,
                playlistId: PLAYLIST_ID,
                position,
                legacyPosition,
            })
        ).resolves.toBe(true);
        expect(order).toEqual([
            `save:${SCOPED_TRACKING_ID}`,
            `clear:${LEGACY_TRACKING_ID}`,
        ]);
    });

    it('does not clear legacy when the scoped save rejects', async () => {
        const saveError = new Error('save failed');
        const repository = {
            savePlaybackPosition: jest.fn().mockRejectedValue(saveError),
            clearPlaybackPosition: jest.fn().mockResolvedValue(undefined),
        };

        await expect(
            saveStalkerSeriesPosition({
                repository,
                playlistId: PLAYLIST_ID,
                position: createPosition(),
                legacyPosition: createPosition({
                    contentXtreamId: LEGACY_TRACKING_ID,
                }),
            })
        ).rejects.toBe(saveError);
        expect(repository.clearPlaybackPosition).not.toHaveBeenCalled();
    });

    it('reports a partial save when legacy cleanup rejects after the scoped write', async () => {
        const order: string[] = [];
        const clearError = new Error('clear failed');
        const repository = {
            savePlaybackPosition: jest.fn(
                async (_playlistId: string, position: PlaybackPositionData) => {
                    order.push(`save:${position.contentXtreamId}`);
                }
            ),
            clearPlaybackPosition: jest.fn(
                async (_playlistId: string, contentXtreamId: number) => {
                    order.push(`clear:${contentXtreamId}`);
                    throw clearError;
                }
            ),
        };

        const save = saveStalkerSeriesPosition({
            repository,
            playlistId: PLAYLIST_ID,
            position: createPosition(),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
            }),
        });

        const rejection = await save.catch(
            (error: unknown) => error
        );
        expect(rejection).toBeInstanceOf(
            StalkerSeriesPositionPartialSaveError
        );
        if (
            !(rejection instanceof
                StalkerSeriesPositionPartialSaveError)
        ) {
            throw new Error('Expected a partial save error');
        }
        expect(rejection.cause).toBe(clearError);
        expect(rejection.scopedPositionSaved).toBe(true);
        expect(order).toEqual([
            `save:${SCOPED_TRACKING_ID}`,
            `clear:${LEGACY_TRACKING_ID}`,
        ]);
    });

    const rejectedOwnershipCases: RejectedOwnershipCase[] = [
        {
            name: 'different parents',
            position: createPosition(),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
                seriesXtreamId: FOREIGN_SERIES_ID,
            }),
        },
        {
            name: 'missing scoped parent',
            position: createPosition({ seriesXtreamId: undefined }),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
            }),
        },
        {
            name: 'missing legacy parent',
            position: createPosition(),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
                seriesXtreamId: undefined,
            }),
        },
        {
            name: 'equal scoped and legacy IDs',
            position: createPosition(),
            legacyPosition: createPosition(),
        },
        {
            name: 'non-episode scoped content',
            position: createPosition({ contentType: 'vod' }),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
            }),
        },
        {
            name: 'non-episode legacy content',
            position: createPosition(),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
                contentType: 'vod',
            }),
        },
        {
            name: 'conflicting scoped playlist',
            position: createPosition({ playlistId: 'playlist-2' }),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
            }),
        },
        {
            name: 'conflicting legacy playlist',
            position: createPosition(),
            legacyPosition: createPosition({
                contentXtreamId: LEGACY_TRACKING_ID,
                playlistId: 'playlist-2',
            }),
        },
        {
            name: 'missing legacy row',
            position: createPosition(),
        },
    ];

    it.each(rejectedOwnershipCases)(
        'does not clean an unowned legacy row for $name',
        async ({ position, legacyPosition }) => {
            const saveRepository = {
                savePlaybackPosition: jest.fn().mockResolvedValue(undefined),
                clearPlaybackPosition: jest
                    .fn()
                    .mockResolvedValue(undefined),
            };
            await expect(
                saveStalkerSeriesPosition({
                    repository: saveRepository,
                    playlistId: PLAYLIST_ID,
                    position,
                    legacyPosition,
                })
            ).resolves.toBe(false);
            expect(
                saveRepository.savePlaybackPosition
            ).toHaveBeenCalledWith(PLAYLIST_ID, position);
            expect(
                saveRepository.clearPlaybackPosition
            ).not.toHaveBeenCalled();

            const clearRepository = {
                clearPlaybackPosition: jest
                    .fn()
                    .mockResolvedValue(undefined),
            };
            await expect(
                clearStalkerSeriesPosition({
                    repository: clearRepository,
                    playlistId: PLAYLIST_ID,
                    position,
                    legacyPosition,
                })
            ).resolves.toBe(false);
            expect(
                clearRepository.clearPlaybackPosition
            ).toHaveBeenCalledTimes(1);
            expect(
                clearRepository.clearPlaybackPosition
            ).toHaveBeenCalledWith(
                PLAYLIST_ID,
                position.contentXtreamId,
                position.contentType
            );
        }
    );

    it('clears confirmed legacy before scoped state and cannot resurrect it', async () => {
        const episode = createEpisode({
            legacyTrackingId: LEGACY_TRACKING_ID,
        });
        const exactPosition = createPosition();
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
            positionSeconds: 20,
        });
        const rows = new Map<number, PlaybackPositionData>([
            [SCOPED_TRACKING_ID, exactPosition],
            [LEGACY_TRACKING_ID, legacyPosition],
        ]);
        const order: string[] = [];
        const repository = {
            clearPlaybackPosition: jest.fn(
                async (
                    _playlistId: string,
                    contentXtreamId: number
                ) => {
                    order.push(`clear:${contentXtreamId}`);
                    rows.delete(contentXtreamId);
                }
            ),
        };

        await expect(
            clearStalkerSeriesPosition({
                repository,
                playlistId: PLAYLIST_ID,
                position: exactPosition,
                legacyPosition,
            })
        ).resolves.toBe(true);
        expect(order).toEqual([
            `clear:${LEGACY_TRACKING_ID}`,
            `clear:${SCOPED_TRACKING_ID}`,
        ]);

        const refreshed = reconcile([episode], [...rows.values()]);
        expect(refreshed.positionsByTrackingId.size).toBe(0);
        expect(refreshed.legacyPositionByTrackingId.size).toBe(0);
    });

    it('leaves exact scoped progress when legacy cleanup rejects', async () => {
        const episode = createEpisode({
            legacyTrackingId: LEGACY_TRACKING_ID,
        });
        const exactPosition = createPosition();
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
        });
        const rows = new Map<number, PlaybackPositionData>([
            [SCOPED_TRACKING_ID, exactPosition],
            [LEGACY_TRACKING_ID, legacyPosition],
        ]);
        const clearError = new Error('legacy clear failed');
        const repository = {
            clearPlaybackPosition: jest.fn(
                async (
                    _playlistId: string,
                    contentXtreamId: number
                ) => {
                    if (contentXtreamId === LEGACY_TRACKING_ID) {
                        throw clearError;
                    }
                    rows.delete(contentXtreamId);
                }
            ),
        };

        await expect(
            clearStalkerSeriesPosition({
                repository,
                playlistId: PLAYLIST_ID,
                position: exactPosition,
                legacyPosition,
            })
        ).rejects.toBe(clearError);
        expect(rows.get(SCOPED_TRACKING_ID)).toBe(exactPosition);
        expect(
            reconcile([episode], [...rows.values()])
                .positionsByTrackingId
                .get(SCOPED_TRACKING_ID)
        ).toBe(exactPosition);
    });

    it('leaves exact scoped progress when scoped clear rejects after legacy cleanup', async () => {
        const episode = createEpisode({
            legacyTrackingId: LEGACY_TRACKING_ID,
        });
        const exactPosition = createPosition();
        const legacyPosition = createPosition({
            contentXtreamId: LEGACY_TRACKING_ID,
        });
        const rows = new Map<number, PlaybackPositionData>([
            [SCOPED_TRACKING_ID, exactPosition],
            [LEGACY_TRACKING_ID, legacyPosition],
        ]);
        const order: number[] = [];
        const clearError = new Error('scoped clear failed');
        const repository = {
            clearPlaybackPosition: jest.fn(
                async (
                    _playlistId: string,
                    contentXtreamId: number
                ) => {
                    order.push(contentXtreamId);
                    if (contentXtreamId === SCOPED_TRACKING_ID) {
                        throw clearError;
                    }
                    rows.delete(contentXtreamId);
                }
            ),
        };

        await expect(
            clearStalkerSeriesPosition({
                repository,
                playlistId: PLAYLIST_ID,
                position: exactPosition,
                legacyPosition,
            })
        ).rejects.toBe(clearError);
        expect(order).toEqual([LEGACY_TRACKING_ID, SCOPED_TRACKING_ID]);
        expect(rows.has(LEGACY_TRACKING_ID)).toBe(false);
        expect(rows.get(SCOPED_TRACKING_ID)).toBe(exactPosition);

        const refreshed = reconcile([episode], [...rows.values()]);
        expect(
            refreshed.positionsByTrackingId.get(SCOPED_TRACKING_ID)
        ).toBe(exactPosition);
        expect(refreshed.legacyPositionByTrackingId.size).toBe(0);
    });
});
