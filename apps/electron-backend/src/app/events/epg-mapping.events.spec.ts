import type EpgEventsType from './epg.events';

const getDatabase = jest.fn();
const getEpgMapping = jest.fn();
const getEpgMappingsBatch = jest.fn();
const setEpgMapping = jest.fn();
const deleteEpgMapping = jest.fn();
const searchEpgChannels = jest.fn();
const ipcHandlers = new Map<
    string,
    (event: unknown, args: unknown) => Promise<unknown>
>();

jest.mock('electron', () => ({
    app: {
        isPackaged: false,
        getAppPath: () => '/mock/app.asar',
    },
    BrowserWindow: {
        getAllWindows: () => [],
    },
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

jest.mock('../database/operations/epg-mapping.operations', () => ({
    getEpgMapping: (...args: unknown[]) => getEpgMapping(...args),
    getEpgMappingsBatch: (...args: unknown[]) => getEpgMappingsBatch(...args),
    setEpgMapping: (...args: unknown[]) => setEpgMapping(...args),
    deleteEpgMapping: (...args: unknown[]) => deleteEpgMapping(...args),
    searchEpgChannels: (...args: unknown[]) => searchEpgChannels(...args),
}));

/**
 * The EPG mapping IPC handlers must fail soft: a mapping lookup is a side
 * concern of an EPG request and must never take that request down. The
 * handlers wrap the DB call in try/catch, but a bare `return promise` inside
 * an async function is *adopted*, not awaited — so the catch block only ever
 * saw a synchronous `getDatabase()` failure while a rejection from the query
 * itself escaped to the IPC caller. These tests pin both failure modes.
 */
describe('EPG mapping IPC handlers', () => {
    let EpgEvents: typeof EpgEventsType;

    beforeEach(async () => {
        jest.resetModules();
        ipcHandlers.clear();
        [
            getDatabase,
            getEpgMapping,
            getEpgMappingsBatch,
            setEpgMapping,
            deleteEpgMapping,
            searchEpgChannels,
        ].forEach((mock) => mock.mockReset());

        getDatabase.mockResolvedValue({});

        ({ default: EpgEvents } = await import('./epg.events'));

        const { ipcMain } = jest.requireMock('electron');
        (ipcMain.handle as jest.Mock).mockReset();
        (ipcMain.handle as jest.Mock).mockImplementation(
            (
                channel: string,
                handler: (event: unknown, args: unknown) => Promise<unknown>
            ) => {
                ipcHandlers.set(channel, handler);
            }
        );

        EpgEvents.bootstrapEpgEvents();
    });

    function invoke(channel: string, args: unknown): Promise<unknown> {
        const handler = ipcHandlers.get(channel);
        if (!handler) {
            throw new Error(`No IPC handler registered for "${channel}"`);
        }
        return handler({}, args);
    }

    describe.each([
        {
            channel: 'EPG_MAPPING_GET',
            args: { channelKey: 'bbc.one.uk' },
            operation: () => getEpgMapping,
            resolved: {
                id: 1,
                channelKey: 'bbc.one.uk',
                epgChannelId: 'BBC.ONE.UK',
                playlistId: null,
            },
            fallback: null,
        },
        {
            channel: 'EPG_MAPPING_SET',
            args: { channelKey: 'bbc.one.uk', epgChannelId: 'BBC.ONE.UK' },
            operation: () => setEpgMapping,
            resolved: { success: true },
            fallback: { success: false },
        },
        {
            channel: 'EPG_MAPPING_DELETE',
            args: { channelKey: 'bbc.one.uk' },
            operation: () => deleteEpgMapping,
            resolved: { success: true },
            fallback: { success: false },
        },
        {
            channel: 'EPG_CHANNEL_SEARCH',
            args: { searchTerm: 'bbc' },
            operation: () => searchEpgChannels,
            resolved: [
                { id: 'BBC.ONE.UK', displayName: 'BBC One', iconUrl: null },
            ],
            fallback: [],
        },
        {
            channel: 'EPG_MAPPING_GET_BATCH',
            args: { channelKeys: ['bbc.one.uk'] },
            operation: () => getEpgMappingsBatch,
            resolved: new Map([['bbc.one.uk', 'BBC.ONE.UK']]),
            fallback: {},
        },
    ])('$channel', ({ channel, args, operation, resolved, fallback }) => {
        it('returns the fallback when the underlying query rejects', async () => {
            operation().mockRejectedValue(new Error('database is locked'));

            await expect(invoke(channel, args)).resolves.toEqual(fallback);
        });

        it('returns the fallback when opening the database rejects', async () => {
            getDatabase.mockRejectedValue(new Error('no such file'));

            await expect(invoke(channel, args)).resolves.toEqual(fallback);
            expect(operation()).not.toHaveBeenCalled();
        });

        it('passes the resolved value through on success', async () => {
            operation().mockResolvedValue(resolved);

            const result = await invoke(channel, args);

            expect(result).toEqual(
                // The batch handler is the one that reshapes its result.
                resolved instanceof Map
                    ? Object.fromEntries(resolved)
                    : resolved
            );
        });
    });

    it('short-circuits a blank search term without touching the database', async () => {
        await expect(
            invoke('EPG_CHANNEL_SEARCH', { searchTerm: '   ' })
        ).resolves.toEqual([]);
        expect(getDatabase).not.toHaveBeenCalled();
        expect(searchEpgChannels).not.toHaveBeenCalled();
    });

    it('short-circuits an empty batch without touching the database', async () => {
        await expect(
            invoke('EPG_MAPPING_GET_BATCH', { channelKeys: [] })
        ).resolves.toEqual({});
        expect(getDatabase).not.toHaveBeenCalled();
        expect(getEpgMappingsBatch).not.toHaveBeenCalled();
    });
});
