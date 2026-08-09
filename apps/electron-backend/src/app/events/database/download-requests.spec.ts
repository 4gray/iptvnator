import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import type { Download } from '../../database/schema';
import type { DownloadDirectoryAuthorizer } from './download-directory-authorization';

const metadataSnapshot: DownloadMetadataSnapshot = {
    version: 1,
    language: 'en',
    mediaKind: 'movie',
    title: 'Offline Movie',
};

async function setupStartMetadataRequest(
    existing: Record<string, unknown> | undefined,
    coordinateRows: Record<string, unknown>[] = [],
    completedFileAvailability: 'available' | 'missing' | 'unknown' = 'missing'
) {
    jest.resetModules();
    const schema = await import('../../database/schema');
    const playlistLimit = jest.fn().mockResolvedValue([{ id: 'playlist-1' }]);
    const downloadLimit = jest.fn((limit: number) =>
        Promise.resolve(
            limit === 2 ? coordinateRows : existing ? [existing] : []
        )
    );
    const from = jest.fn((table: unknown) => ({
        where: jest.fn(() => ({
            limit: table === schema.playlists ? playlistLimit : downloadLimit,
        })),
    }));
    const insertValues = jest.fn().mockResolvedValue({ lastInsertRowid: 84 });
    const set = jest.fn<{ where: jest.Mock }, [Record<string, unknown>]>(
        () => ({
            where: jest.fn().mockResolvedValue(undefined),
        })
    );
    const db = {
        insert: jest.fn(() => ({ values: insertValues })),
        select: jest.fn(() => ({
            from,
        })),
        update: jest.fn(() => ({ set })),
    };
    const enqueueDownload = jest.fn();
    const getDownloadFileAvailabilityAsync = jest.fn(
        async () => completedFileAvailability
    );
    const getDownloadFileAvailabilityWithTimeoutAsync = jest.fn(
        async () => completedFileAvailability
    );
    const isAvailableDownloadFile = jest.fn(
        () => completedFileAvailability === 'available'
    );
    const authorizer = {
        requireAuthorized: jest.fn(async (directory: string) => directory),
    } as unknown as DownloadDirectoryAuthorizer;

    jest.doMock('../../database/connection', () => ({
        getDatabase: jest.fn().mockResolvedValue(db),
    }));
    jest.doMock('../url-safety', () => ({
        assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
    }));
    jest.doMock('./download-runtime', () => ({
        enqueueDownload,
    }));
    jest.doMock('./download-file-availability', () => ({
        getDownloadFileAvailabilityAsync,
        getDownloadFileAvailabilityWithTimeoutAsync,
        isAvailableDownloadFile,
    }));

    const { startDownloadRequest } = await import('./download-requests');
    return {
        authorizer,
        db,
        downloadLimit,
        enqueueDownload,
        getDownloadFileAvailabilityAsync,
        getDownloadFileAvailabilityWithTimeoutAsync,
        insertValues,
        isAvailableDownloadFile,
        set,
        startDownloadRequest,
    };
}

function createStartDownloadRow(overrides: Partial<Download> = {}): Download {
    return {
        bytesDownloaded: 0,
        contentType: 'episode',
        createdAt: '2026-08-02 10:00:00',
        episodeNumber: 3,
        episodeIdentityScope: null,
        errorMessage: null,
        fileName: 'episode.mp4',
        filePath: null,
        id: 42,
        metadataSnapshot: null,
        playlistId: 'playlist-1',
        posterUrl: null,
        requestHeaders: null,
        resumeValidator: null,
        seasonNumber: 2,
        seriesXtreamId: 100,
        status: 'canceled',
        title: 'Episode 3',
        totalBytes: null,
        updatedAt: '2026-08-02 10:00:00',
        url: 'https://example.test/episode.mp4',
        xtreamId: 77,
        ...overrides,
    };
}

function startPayload(
    snapshot?: DownloadMetadataSnapshot,
    contentType: 'vod' | 'episode' = 'vod'
) {
    return {
        contentType,
        downloadFolder: '/downloads',
        metadataSnapshot: snapshot,
        playlistId: 'playlist-1',
        title: 'Offline Movie',
        url: 'https://example.test/movie.mp4',
        xtreamId: 7,
    };
}

function episodeStartPayload() {
    return {
        ...startPayload(undefined, 'episode'),
        episodeNumber: 3,
        seasonNumber: 2,
        seriesXtreamId: 100,
        title: 'Episode 3',
        url: 'https://example.test/episode.mp4',
        xtreamId: 700,
    };
}

describe('download request metadata snapshots', () => {
    it('persists an encoded snapshot for a new download', async () => {
        const request = await setupStartMetadataRequest(undefined);

        await expect(
            request.startDownloadRequest(
                startPayload(metadataSnapshot),
                request.authorizer
            )
        ).resolves.toEqual({ id: 84, success: true });

        expect(request.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                metadataSnapshot: JSON.stringify(metadataSnapshot),
            })
        );
    });

    it('preserves stored metadata when a restart omits a snapshot', async () => {
        const request = await setupStartMetadataRequest({
            contentType: 'vod',
            filePath: null,
            id: 42,
            metadataSnapshot: JSON.stringify(metadataSnapshot),
            playlistId: 'playlist-1',
            status: 'canceled',
            title: 'Offline Movie',
            url: 'https://example.test/movie.mp4',
            xtreamId: 7,
        });

        await expect(
            request.startDownloadRequest(startPayload(), request.authorizer)
        ).resolves.toEqual({ id: 42, success: true });

        expect(request.set).toHaveBeenCalledTimes(1);
        expect(request.set.mock.calls[0][0]).not.toHaveProperty(
            'metadataSnapshot'
        );
        expect(request.set.mock.calls[0][0]).not.toHaveProperty('xtreamId');
    });

    it('replaces stored metadata when a restart supplies a snapshot', async () => {
        const request = await setupStartMetadataRequest({
            contentType: 'vod',
            filePath: null,
            id: 42,
            metadataSnapshot: null,
            playlistId: 'playlist-1',
            status: 'canceled',
            title: 'Offline Movie',
            url: 'https://example.test/movie.mp4',
            xtreamId: 7,
        });

        await request.startDownloadRequest(
            startPayload(metadataSnapshot),
            request.authorizer
        );

        expect(request.set).toHaveBeenCalledWith(
            expect.objectContaining({
                metadataSnapshot: JSON.stringify(metadataSnapshot),
            })
        );
    });

    it('rejects invalid metadata before mutating a download row', async () => {
        const request = await setupStartMetadataRequest({
            contentType: 'vod',
            filePath: null,
            id: 42,
            playlistId: 'playlist-1',
            status: 'canceled',
            title: 'Offline Movie',
            url: 'https://example.test/movie.mp4',
            xtreamId: 7,
        });

        await expect(
            request.startDownloadRequest(
                startPayload({
                    ...metadataSnapshot,
                    title: ' ',
                }),
                request.authorizer
            )
        ).rejects.toThrow('Invalid download metadata snapshot');

        expect(request.db.update).not.toHaveBeenCalled();
        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });

    it.each([
        ['vod', 'series'],
        ['episode', 'movie'],
    ] as const)(
        'rejects a new %s row carrying %s metadata',
        async (contentType, mediaKind) => {
            const request = await setupStartMetadataRequest(undefined);

            await expect(
                request.startDownloadRequest(
                    startPayload(
                        { ...metadataSnapshot, mediaKind },
                        contentType
                    ),
                    request.authorizer
                )
            ).rejects.toThrow('Invalid download metadata snapshot');

            expect(request.db.insert).not.toHaveBeenCalled();
            expect(request.db.update).not.toHaveBeenCalled();
            expect(request.enqueueDownload).not.toHaveBeenCalled();
        }
    );

    it.each([
        ['episode', 'movie'],
        ['vod', 'series'],
    ] as const)(
        'rejects a stored %s restart carrying %s metadata',
        async (contentType, mediaKind) => {
            const request = await setupStartMetadataRequest({
                contentType,
                filePath: null,
                id: 42,
                metadataSnapshot: null,
                playlistId: 'playlist-1',
                status: 'canceled',
                title: 'Offline Item',
                url: 'https://example.test/item.mp4',
                xtreamId: 7,
            });

            await expect(
                request.startDownloadRequest(
                    startPayload(
                        { ...metadataSnapshot, mediaKind },
                        contentType
                    ),
                    request.authorizer
                )
            ).rejects.toThrow('Invalid download metadata snapshot');

            expect(request.db.insert).not.toHaveBeenCalled();
            expect(request.db.update).not.toHaveBeenCalled();
            expect(request.enqueueDownload).not.toHaveBeenCalled();
        }
    );

    it.each<[string, 'vod' | 'episode', DownloadMetadataSnapshot]>([
        [
            'poster',
            'vod',
            {
                ...metadataSnapshot,
                posterUrl: 'https://streams.example.test/images/live.jpg',
            },
        ],
        [
            'backdrop',
            'vod',
            {
                ...metadataSnapshot,
                backdropUrl: 'https://streams.example.test/images/live.jpg',
            },
        ],
        [
            'person profile',
            'vod',
            {
                ...metadataSnapshot,
                cast: [
                    {
                        name: 'Actor',
                        profileUrl:
                            'https://streams.example.test/images/live.jpg',
                    },
                ],
            },
        ],
        [
            'episode still',
            'episode',
            {
                ...metadataSnapshot,
                mediaKind: 'series',
                episode: {
                    episodeNumber: 1,
                    seasonNumber: 1,
                    stillUrl: 'https://streams.example.test/images/live.jpg',
                },
            },
        ],
    ])(
        'rejects a new download whose stream URL is reused as %s artwork',
        async (_label, contentType, snapshot) => {
            const request = await setupStartMetadataRequest(undefined);
            const url = 'https://streams.example.test/images/live.jpg';

            await expect(
                request.startDownloadRequest(
                    {
                        ...startPayload(snapshot, contentType),
                        url,
                    },
                    request.authorizer
                )
            ).rejects.toThrow('Invalid download metadata snapshot');

            expect(request.db.insert).not.toHaveBeenCalled();
            expect(request.db.update).not.toHaveBeenCalled();
            expect(request.enqueueDownload).not.toHaveBeenCalled();
        }
    );

    it('rejects a new download when its stream differs from artwork only by a fragment', async () => {
        const artworkUrl = 'https://streams.example.test/images/live.jpg';
        const request = await setupStartMetadataRequest(undefined);

        await expect(
            request.startDownloadRequest(
                {
                    ...startPayload({
                        ...metadataSnapshot,
                        posterUrl: artworkUrl,
                    }),
                    url: `${artworkUrl}#player`,
                },
                request.authorizer
            )
        ).rejects.toThrow('Invalid download metadata snapshot');

        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.db.update).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });

    it('rejects a restart whose poster reuses the normalized stored stream URL', async () => {
        const storedUrl =
            'https://STREAMS.example.test:443/images/section/../live.jpg#player';
        const posterUrl = 'https://streams.example.test/images/live.jpg';
        const request = await setupStartMetadataRequest({
            contentType: 'vod',
            filePath: null,
            id: 42,
            metadataSnapshot: null,
            playlistId: 'playlist-1',
            status: 'canceled',
            title: 'Offline Movie',
            url: storedUrl,
            xtreamId: 7,
        });

        await expect(
            request.startDownloadRequest(
                {
                    ...startPayload({
                        ...metadataSnapshot,
                        posterUrl,
                    }),
                    url: 'https://replacement.example.test/movie.mp4',
                },
                request.authorizer
            )
        ).rejects.toThrow('Invalid download metadata snapshot');

        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.db.update).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });

    it('rejects a restart whose poster reuses the replacement stream URL', async () => {
        const artworkUrl = 'https://replacement.example.test/images/live.jpg';
        const replacementUrl = `${artworkUrl}#player`;
        const request = await setupStartMetadataRequest({
            contentType: 'vod',
            filePath: null,
            id: 42,
            metadataSnapshot: null,
            playlistId: 'playlist-1',
            status: 'canceled',
            title: 'Offline Movie',
            url: 'https://stored.example.test/movie.mp4',
            xtreamId: 7,
        });

        await expect(
            request.startDownloadRequest(
                {
                    ...startPayload({
                        ...metadataSnapshot,
                        posterUrl: artworkUrl,
                    }),
                    url: replacementUrl,
                },
                request.authorizer
            )
        ).rejects.toThrow('Invalid download metadata snapshot');

        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.db.update).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });
});

describe('download request identity resolution', () => {
    it('skips a completed download whose file became available after the list snapshot', async () => {
        const completedRow = createStartDownloadRow({
            filePath: '/downloads/restored-episode.mp4',
            status: 'completed',
            xtreamId: 700,
        });
        const request = await setupStartMetadataRequest(
            completedRow,
            [completedRow],
            'available'
        );

        await expect(
            request.startDownloadRequest(
                episodeStartPayload(),
                request.authorizer
            )
        ).resolves.toEqual({
            error: 'Download already completed',
            id: completedRow.id,
            reason: 'already-downloaded',
            success: false,
        });

        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.db.update).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
        expect(
            request.getDownloadFileAvailabilityWithTimeoutAsync
        ).toHaveBeenCalledWith(completedRow);
        expect(request.getDownloadFileAvailabilityAsync).not.toHaveBeenCalled();
        expect(request.isAvailableDownloadFile).not.toHaveBeenCalled();
    });

    it('fails closed when a completed-file recheck times out', async () => {
        const completedRow = createStartDownloadRow({
            filePath: '/downloads/unresponsive/episode.mp4',
            status: 'completed',
            xtreamId: 700,
        });
        const request = await setupStartMetadataRequest(
            completedRow,
            [completedRow],
            'unknown'
        );

        await expect(
            request.startDownloadRequest(
                episodeStartPayload(),
                request.authorizer
            )
        ).resolves.toEqual({
            error: 'Could not verify the completed download file',
            id: completedRow.id,
            success: false,
        });

        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.db.update).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });

    it.each(['queued', 'downloading', 'paused'] as const)(
        'returns the stable duplicate result for an active legacy-coordinate %s row',
        async (status) => {
            const legacyRow = createStartDownloadRow({ status });
            const request = await setupStartMetadataRequest(undefined, [
                legacyRow,
            ]);

            await expect(
                request.startDownloadRequest(
                    episodeStartPayload(),
                    request.authorizer
                )
            ).resolves.toEqual({
                error: 'Download already in progress',
                id: legacyRow.id,
                reason: 'already-in-progress',
                success: false,
            });

            expect(request.db.insert).not.toHaveBeenCalled();
            expect(request.db.update).not.toHaveBeenCalled();
            expect(request.enqueueDownload).not.toHaveBeenCalled();
        }
    );

    it('keeps the stable duplicate reason for an exact active row', async () => {
        const exactRow = createStartDownloadRow({
            status: 'queued',
            xtreamId: 700,
        });
        const request = await setupStartMetadataRequest(exactRow, [exactRow]);

        await expect(
            request.startDownloadRequest(
                episodeStartPayload(),
                request.authorizer
            )
        ).resolves.toEqual({
            error: 'Download already in progress',
            id: exactRow.id,
            reason: 'already-in-progress',
            success: false,
        });

        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });

    it.each(['failed', 'canceled', 'completed'] as const)(
        'reuses and migrates a legacy-coordinate %s row before restart',
        async (status) => {
            const legacyRow = createStartDownloadRow({ status });
            const request = await setupStartMetadataRequest(undefined, [
                legacyRow,
            ]);

            await expect(
                request.startDownloadRequest(
                    episodeStartPayload(),
                    request.authorizer
                )
            ).resolves.toEqual({ id: legacyRow.id, success: true });

            expect(request.set).toHaveBeenCalledTimes(1);
            expect(request.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'queued',
                    xtreamId: episodeStartPayload().xtreamId,
                })
            );
            expect(request.enqueueDownload).toHaveBeenCalledWith(
                expect.objectContaining({ id: legacyRow.id })
            );
        }
    );

    it('rejects conflicting canonical and coordinate rows without enqueueing', async () => {
        const canonicalRow = createStartDownloadRow({
            episodeNumber: null,
            seasonNumber: null,
            seriesXtreamId: null,
            xtreamId: 700,
        });
        const coordinateRow = createStartDownloadRow({ id: 43 });
        const request = await setupStartMetadataRequest(canonicalRow, [
            coordinateRow,
        ]);

        await expect(
            request.startDownloadRequest(
                episodeStartPayload(),
                request.authorizer
            )
        ).resolves.toEqual({
            error: 'Download identity conflict',
            success: false,
        });

        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.db.update).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });

    it('propagates a rejected canonical-id migration before enqueueing', async () => {
        const migrationError = new Error(
            'UNIQUE constraint failed: downloads.xtream_id'
        );
        const legacyRow = createStartDownloadRow({ status: 'canceled' });
        const request = await setupStartMetadataRequest(undefined, [legacyRow]);
        request.set.mockReturnValueOnce({
            where: jest.fn().mockRejectedValue(migrationError),
        });

        await expect(
            request.startDownloadRequest(
                episodeStartPayload(),
                request.authorizer
            )
        ).rejects.toBe(migrationError);

        expect(request.set).toHaveBeenCalledWith(
            expect.objectContaining({
                xtreamId: episodeStartPayload().xtreamId,
            })
        );
        expect(request.db.insert).not.toHaveBeenCalled();
        expect(request.enqueueDownload).not.toHaveBeenCalled();
    });
});

describe('download requests resume', () => {
    it('adds the Xtream fallback User-Agent to a legacy paused row', async () => {
        jest.resetModules();
        const schema = await import('../../database/schema');
        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            playlistId: 'playlist-1',
            requestHeaders: null,
            resumeValidator: '"etag-9"',
            status: 'paused',
            title: 'Movie',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        };
        const downloadLimit = jest.fn().mockResolvedValue([row]);
        const playlistLimit = jest.fn().mockResolvedValue([{ type: 'xtream' }]);
        const db = {
            select: jest.fn(() => ({
                from: jest.fn((table: unknown) => ({
                    where: jest.fn(() => ({
                        limit:
                            table === schema.playlists
                                ? playlistLimit
                                : downloadLimit,
                    })),
                })),
            })),
            update: jest.fn(() => ({
                set: jest.fn(() => ({
                    where: jest.fn().mockResolvedValue({ changes: 1 }),
                })),
            })),
        };
        const enqueueDownload = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-runtime', () => ({ enqueueDownload }));

        const { resumeDownloadRequest } = await import('./download-requests');
        await expect(
            resumeDownloadRequest(42, '/unused', authorizer)
        ).resolves.toEqual({ success: true });

        expect(enqueueDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                headers: {
                    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                },
            })
        );
    });

    it('enqueues a paused download with stored headers and original target path', async () => {
        jest.resetModules();

        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            requestHeaders: JSON.stringify({ 'User-Agent': 'IPTVnator' }),
            resumeValidator: '"etag-9"',
            status: 'paused',
            title: 'Movie',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        };
        const limit = jest.fn().mockResolvedValue([row]);
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({
                set: jest.fn(() => ({
                    where: jest.fn().mockResolvedValue(undefined),
                })),
            })),
        };
        const enqueueDownload = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { resumeDownloadRequest } = await import('./download-requests');

        await expect(
            resumeDownloadRequest(42, '/unused', authorizer)
        ).resolves.toEqual({ success: true });

        // DB-recorded retained paths stay usable after folder switches.
        expect(authorizer.requireAuthorized).not.toHaveBeenCalled();
        expect(enqueueDownload).toHaveBeenCalledWith({
            directory: '/downloads',
            fileName: 'movie.mp4',
            filePath: '/downloads/movie.mp4',
            headers: { 'User-Agent': 'IPTVnator' },
            id: 42,
            resumeValidator: '"etag-9"',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        });
    });

    it('does not enqueue when a concurrent resume already claimed the row', async () => {
        jest.resetModules();

        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            requestHeaders: null,
            resumeValidator: null,
            status: 'paused',
            title: 'Movie',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        };
        const limit = jest.fn().mockResolvedValue([row]);
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({
                set: jest.fn(() => ({
                    // The conditional status='paused' claim matched no rows.
                    where: jest.fn().mockResolvedValue({ changes: 0 }),
                })),
            })),
        };
        const enqueueDownload = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { resumeDownloadRequest } = await import('./download-requests');

        await expect(
            resumeDownloadRequest(42, '/unused', authorizer)
        ).resolves.toEqual({
            error: 'Can only resume paused downloads',
            success: false,
        });
        expect(enqueueDownload).not.toHaveBeenCalled();
    });

    it('retries a failed download with a retained partial at the original target path', async () => {
        jest.resetModules();

        const row = {
            filePath: '/downloads/movie.mp4',
            id: 42,
            requestHeaders: JSON.stringify({ 'User-Agent': 'IPTVnator' }),
            resumeValidator: '"etag-9"',
            status: 'failed',
            title: 'Movie',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        };
        const limit = jest.fn().mockResolvedValue([row]);
        const set = jest.fn<{ where: jest.Mock }, [Record<string, unknown>]>(
            () => ({
                where: jest.fn().mockResolvedValue(undefined),
            })
        );
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };
        const enqueueDownload = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { retryDownloadRequest } = await import('./download-requests');

        await expect(
            retryDownloadRequest(42, '/unused', authorizer)
        ).resolves.toEqual({ success: true });

        const update = set.mock.calls[0][0];
        expect(authorizer.requireAuthorized).not.toHaveBeenCalled();
        expect(update).toEqual(
            expect.objectContaining({
                errorMessage: null,
                fileName: 'movie.mp4',
                status: 'queued',
            })
        );
        expect(update).not.toHaveProperty('bytesDownloaded');
        expect(update).not.toHaveProperty('filePath');
        expect(update).not.toHaveProperty('totalBytes');
        expect(enqueueDownload).toHaveBeenCalledWith({
            directory: '/downloads',
            fileName: 'movie.mp4',
            filePath: '/downloads/movie.mp4',
            headers: { 'User-Agent': 'IPTVnator' },
            id: 42,
            resumeValidator: '"etag-9"',
            totalBytes: 100,
            url: 'https://example.test/movie.mp4',
        });
    });

    it.each(['failed', 'canceled'] as const)(
        'deletes the retained partial asynchronously before re-downloading a %s row from scratch',
        async (status) => {
            jest.resetModules();

            const terminalRow = {
                contentType: 'vod',
                filePath: '/downloads/movie.mp4',
                id: 42,
                playlistId: 'playlist-1',
                status,
                title: 'Movie',
                url: 'https://example.test/movie.mp4',
                xtreamId: 7,
            };
            const limit = jest
                .fn()
                .mockResolvedValueOnce([{ id: 'playlist-1' }])
                .mockResolvedValueOnce([terminalRow]);
            const set = jest.fn<
                { where: jest.Mock },
                [Record<string, unknown>]
            >(() => ({
                where: jest.fn().mockResolvedValue(undefined),
            }));
            const db = {
                select: jest.fn(() => ({
                    from: jest.fn(() => ({
                        where: jest.fn(() => ({ limit })),
                    })),
                })),
                update: jest.fn(() => ({ set })),
            };
            const enqueueDownload = jest.fn();
            const removePartialDownloadFileAsync = jest.fn(
                async () => 'removed' as const
            );
            const authorizer = {
                requireAuthorized: jest.fn(
                    async (directory: string) => directory
                ),
            } as unknown as DownloadDirectoryAuthorizer;

            jest.doMock('../../database/connection', () => ({
                getDatabase: jest.fn().mockResolvedValue(db),
            }));
            jest.doMock('../url-safety', () => ({
                assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
            }));
            jest.doMock('./download-partial-cleanup', () => ({
                removePartialDownloadFileAsync,
            }));
            jest.doMock('./download-runtime', () => ({
                enqueueDownload,
            }));

            const { startDownloadRequest } =
                await import('./download-requests');

            await expect(
                startDownloadRequest(
                    {
                        contentType: 'vod',
                        downloadFolder: '/downloads',
                        playlistId: 'playlist-1',
                        title: 'Movie',
                        url: 'https://example.test/movie.mp4',
                        xtreamId: 7,
                    },
                    authorizer
                )
            ).resolves.toEqual({ id: 42, success: true });

            expect(removePartialDownloadFileAsync).toHaveBeenCalledWith(
                '/downloads/movie.mp4'
            );
            expect(set).toHaveBeenCalledWith(
                expect.objectContaining({
                    filePath: null,
                    resumeValidator: null,
                    status: 'queued',
                })
            );
        }
    );

    it('fails the re-download when the retained partial cannot be deleted', async () => {
        jest.resetModules();

        const failedRow = {
            contentType: 'vod',
            filePath: '/downloads/movie.mp4',
            id: 42,
            playlistId: 'playlist-1',
            status: 'failed',
            title: 'Movie',
            url: 'https://example.test/movie.mp4',
            xtreamId: 7,
        };
        const limit = jest
            .fn()
            .mockResolvedValueOnce([{ id: 'playlist-1' }])
            .mockResolvedValueOnce([failedRow]);
        const set = jest.fn(() => ({
            where: jest.fn().mockResolvedValue(undefined),
        }));
        const db = {
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({ limit })),
                })),
            })),
            update: jest.fn(() => ({ set })),
        };
        const enqueueDownload = jest.fn();
        const removePartialDownloadFileAsync = jest.fn(
            async () => 'unknown' as const
        );
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-partial-cleanup', () => ({
            removePartialDownloadFileAsync,
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            const { startDownloadRequest } =
                await import('./download-requests');

            await expect(
                startDownloadRequest(
                    {
                        contentType: 'vod',
                        downloadFolder: '/downloads',
                        playlistId: 'playlist-1',
                        title: 'Movie',
                        url: 'https://example.test/movie.mp4',
                        xtreamId: 7,
                    },
                    authorizer
                )
            ).resolves.toEqual({
                error: 'Could not delete the previous partial file',
                id: 42,
                success: false,
            });
        } finally {
            consoleError.mockRestore();
        }

        // The row keeps its filePath ownership and nothing is enqueued.
        expect(set).not.toHaveBeenCalled();
        expect(enqueueDownload).not.toHaveBeenCalled();
    });
});
