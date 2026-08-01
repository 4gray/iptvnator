import {
    getHandler,
    mockGetDatabase,
    mockLstat,
    mockLstatSync,
    setupDownloadsEventsHarness,
} from './downloads.test-helpers';

function regularFile() {
    return {
        isFile: () => true,
        isSymbolicLink: () => false,
    };
}

function nextEventLoopTurn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe('downloads events: file availability', () => {
    beforeEach(async () => {
        await setupDownloadsEventsHarness();
    });

    it('loads list availability without synchronous filesystem probes', async () => {
        const row = {
            filePath: '/downloads/network-volume/movie.mp4',
            id: 1,
            status: 'completed',
        };
        const orderBy = jest.fn().mockResolvedValue([row]);
        mockGetDatabase.mockResolvedValue({
            select: jest.fn(() => ({
                from: jest.fn(() => ({ orderBy })),
            })),
        });
        mockLstat.mockResolvedValue(regularFile());
        mockLstatSync.mockImplementation(() => {
            throw new Error('synchronous probe must not run');
        });

        await expect(getHandler('DOWNLOADS_GET_LIST')(null)).resolves.toEqual([
            {
                ...row,
                metadataSnapshot: undefined,
                fileAvailability: 'available',
            },
        ]);
        expect(mockLstat).toHaveBeenCalledWith(row.filePath);
        expect(mockLstatSync).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent probes for the same completed file', async () => {
        const rows = [1, 2].map((id) => ({
            filePath: '/downloads/shared/movie.mp4',
            id,
            status: 'completed',
        }));
        const orderBy = jest.fn().mockResolvedValue(rows);
        mockGetDatabase.mockResolvedValue({
            select: jest.fn(() => ({
                from: jest.fn(() => ({ orderBy })),
            })),
        });
        let finishProbe!: (value: ReturnType<typeof regularFile>) => void;
        mockLstat.mockReturnValue(
            new Promise((resolve) => {
                finishProbe = resolve;
            })
        );

        const response = getHandler('DOWNLOADS_GET_LIST')(null);
        await nextEventLoopTurn();

        expect(mockLstat).toHaveBeenCalledTimes(1);
        finishProbe(regularFile());
        await expect(response).resolves.toHaveLength(2);
    });

    it('starts at most four completed-file probes concurrently', async () => {
        const rows = Array.from({ length: 6 }, (_, index) => ({
            filePath: `/downloads/network/movie-${index}.mp4`,
            id: index + 1,
            status: 'completed',
        }));
        const orderBy = jest.fn().mockResolvedValue(rows);
        mockGetDatabase.mockResolvedValue({
            select: jest.fn(() => ({
                from: jest.fn(() => ({ orderBy })),
            })),
        });
        const finishProbes: Array<
            (value: ReturnType<typeof regularFile>) => void
        > = [];
        mockLstat.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishProbes.push(resolve);
                })
        );

        const response = getHandler('DOWNLOADS_GET_LIST')(null);
        await nextEventLoopTurn();

        expect(mockLstat).toHaveBeenCalledTimes(4);
        finishProbes.slice(0, 4).forEach((finish) => finish(regularFile()));
        await nextEventLoopTurn();
        expect(mockLstat).toHaveBeenCalledTimes(6);
        finishProbes.slice(4).forEach((finish) => finish(regularFile()));
        await expect(response).resolves.toHaveLength(6);
    });

    it('decorates every download in the list from the current filesystem state', async () => {
        const metadataSnapshot = {
            version: 1,
            language: 'en',
            mediaKind: 'movie',
            title: 'Available Movie',
        };
        const rows = [
            {
                filePath: '/downloads/available.mp4',
                id: 1,
                metadataSnapshot: JSON.stringify(metadataSnapshot),
                status: 'completed',
            },
            {
                filePath: '/downloads/missing.mp4',
                id: 2,
                status: 'completed',
            },
            {
                filePath: '/downloads/queued.mp4',
                id: 3,
                status: 'queued',
            },
        ];
        const orderBy = jest.fn().mockResolvedValue(rows);
        mockGetDatabase.mockResolvedValue({
            select: jest.fn(() => ({
                from: jest.fn(() => ({ orderBy })),
            })),
        });
        mockLstat.mockImplementation(async (filePath) => {
            if (filePath === '/downloads/missing.mp4') {
                throw new Error('ENOENT');
            }
            return regularFile();
        });

        await expect(getHandler('DOWNLOADS_GET_LIST')(null)).resolves.toEqual([
            {
                ...rows[0],
                metadataSnapshot,
                fileAvailability: 'available',
            },
            {
                ...rows[1],
                metadataSnapshot: undefined,
                fileAvailability: 'missing',
            },
            {
                ...rows[2],
                metadataSnapshot: undefined,
                fileAvailability: 'not-applicable',
            },
        ]);
        expect(mockLstat).toHaveBeenCalledTimes(2);
    });

    it('decorates an individual download from the current filesystem state', async () => {
        const row = {
            filePath: '/downloads/missing.mp4',
            id: 2,
            metadataSnapshot: '{corrupt',
            status: 'completed',
        };
        mockGetDatabase.mockResolvedValue({
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({
                        limit: jest.fn().mockResolvedValue([row]),
                    })),
                })),
            })),
        });
        mockLstat.mockImplementation(async () => {
            throw new Error('ENOENT');
        });

        await expect(getHandler('DOWNLOADS_GET')(null, 2)).resolves.toEqual({
            ...row,
            metadataSnapshot: undefined,
            fileAvailability: 'missing',
        });
    });

    it('keeps a missing individual download response nullable', async () => {
        mockGetDatabase.mockResolvedValue({
            select: jest.fn(() => ({
                from: jest.fn(() => ({
                    where: jest.fn(() => ({
                        limit: jest.fn().mockResolvedValue([]),
                    })),
                })),
            })),
        });

        await expect(
            getHandler('DOWNLOADS_GET')(null, 404)
        ).resolves.toBeNull();
        expect(mockLstat).not.toHaveBeenCalled();
    });
});
