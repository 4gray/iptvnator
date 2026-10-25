const registeredHandlers = new Map<string, (...args: unknown[]) => unknown>();
const axiosGet = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(
            (channel: string, handler: (...args: unknown[]) => unknown) => {
                registeredHandlers.set(channel, handler);
            }
        ),
    },
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: { get: axiosGet },
}));

describe('IntroDB segments handler', () => {
    const request = { imdbId: 'tt0903747', seasonNumber: 1, episodeNumber: 2 };

    beforeEach(async () => {
        jest.resetModules();
        registeredHandlers.clear();
        axiosGet.mockReset();

        const { registerIntroDbHandlers } = await import('./introdb.events');
        registerIntroDbHandlers();
    });

    const invoke = (payload: unknown) =>
        registeredHandlers.get('INTRODB:GET_SEGMENTS')?.({}, payload);

    it('asks the fixed IntroDB host for the episode and normalizes the answer', async () => {
        axiosGet.mockResolvedValue({
            status: 200,
            data: {
                intro: { start_ms: 314500, end_ms: 331000 },
                recap: null,
                outro: null,
            },
        });

        await expect(invoke(request)).resolves.toEqual({
            intro: { startSeconds: 314.5, endSeconds: 331 },
            recap: null,
            outro: null,
        });
        expect(axiosGet).toHaveBeenCalledWith(
            'https://api.introdb.app/segments',
            expect.objectContaining({
                params: { imdb_id: 'tt0903747', season: 1, episode: 2 },
                maxRedirects: 0,
            })
        );
    });

    it('never sends a request for an invalid payload', async () => {
        await expect(
            invoke({ ...request, imdbId: 'https://evil.test' })
        ).resolves.toBeNull();
        await expect(invoke(undefined)).resolves.toBeNull();
        expect(axiosGet).not.toHaveBeenCalled();
    });

    it('is null when the episode is unknown or IntroDB is unreachable', async () => {
        axiosGet.mockResolvedValueOnce({
            status: 404,
            data: { error: 'Intro not found' },
        });
        await expect(invoke(request)).resolves.toBeNull();

        axiosGet.mockRejectedValueOnce(new Error('ETIMEDOUT'));
        await expect(invoke(request)).resolves.toBeNull();
    });
});
