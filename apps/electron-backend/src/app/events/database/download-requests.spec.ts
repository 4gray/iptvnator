import type { DownloadMetadataSnapshot } from '@iptvnator/shared/interfaces';
import type { DownloadDirectoryAuthorizer } from './download-directory-authorization';

const metadataSnapshot: DownloadMetadataSnapshot = {
    version: 1,
    language: 'en',
    mediaKind: 'movie',
    title: 'Offline Movie',
};

async function setupStartMetadataRequest(
    existing: Record<string, unknown> | undefined
) {
    jest.resetModules();
    const schema = await import('../../database/schema');
    const playlistLimit = jest.fn().mockResolvedValue([{ id: 'playlist-1' }]);
    const downloadLimit = jest
        .fn()
        .mockResolvedValue(existing ? [existing] : []);
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

    const { startDownloadRequest } = await import('./download-requests');
    return {
        authorizer,
        db,
        enqueueDownload,
        insertValues,
        set,
        startDownloadRequest,
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

    it('rejects a restart whose poster reuses the normalized stored stream URL', async () => {
        const storedUrl =
            'https://STREAMS.example.test:443/images/section/../live.jpg';
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
        const replacementUrl =
            'https://replacement.example.test/images/live.jpg';
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
                        posterUrl: replacementUrl,
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

describe('download requests resume', () => {
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

    it('deletes the retained partial before re-downloading a failed row from scratch', async () => {
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
        const removePartialDownloadFile = jest.fn();
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-file-path', () => ({
            removePartialDownloadFile,
        }));
        jest.doMock('./download-runtime', () => ({
            enqueueDownload,
        }));

        const { startDownloadRequest } = await import('./download-requests');

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

        expect(removePartialDownloadFile).toHaveBeenCalledWith(
            '/downloads/movie.mp4'
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                filePath: null,
                resumeValidator: null,
                status: 'queued',
            })
        );
    });

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
        const removePartialDownloadFile = jest.fn(() => {
            throw new Error('EPERM: locked');
        });
        const authorizer = {
            requireAuthorized: jest.fn(async (directory: string) => directory),
        } as unknown as DownloadDirectoryAuthorizer;

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../url-safety', () => ({
            assertRemoteUrlAllowed: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('./download-file-path', () => ({
            removePartialDownloadFile,
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
