import {
    getHandler,
    mockGetDatabase,
    mockLstatSync,
    setupDownloadsEventsHarness,
} from './downloads.test-helpers';

function regularFile() {
    return {
        isFile: () => true,
        isSymbolicLink: () => false,
    };
}

describe('downloads events: file availability', () => {
    beforeEach(async () => {
        await setupDownloadsEventsHarness();
    });

    it('decorates every download in the list from the current filesystem state', async () => {
        const rows = [
            {
                filePath: '/downloads/available.mp4',
                id: 1,
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
        mockLstatSync.mockImplementation((filePath) => {
            if (filePath === '/downloads/missing.mp4') {
                throw new Error('ENOENT');
            }
            return regularFile();
        });

        await expect(
            getHandler('DOWNLOADS_GET_LIST')(null)
        ).resolves.toEqual([
            { ...rows[0], fileAvailability: 'available' },
            { ...rows[1], fileAvailability: 'missing' },
            { ...rows[2], fileAvailability: 'not-applicable' },
        ]);
        expect(mockLstatSync).toHaveBeenCalledTimes(2);
    });

    it('decorates an individual download from the current filesystem state', async () => {
        const row = {
            filePath: '/downloads/missing.mp4',
            id: 2,
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
        mockLstatSync.mockImplementation(() => {
            throw new Error('ENOENT');
        });

        await expect(getHandler('DOWNLOADS_GET')(null, 2)).resolves.toEqual({
            ...row,
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

        await expect(getHandler('DOWNLOADS_GET')(null, 404)).resolves.toBeNull();
        expect(mockLstatSync).not.toHaveBeenCalled();
    });
});
