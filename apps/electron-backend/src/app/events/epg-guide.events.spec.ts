import type EpgEventsType from './epg.events';

const getProgramsForChannels = jest.fn();
const getProgramCoverage = jest.fn();
const resolveChannelIds = jest.fn();
const resolveChannelIdsStrict = jest.fn();
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

jest.mock('./epg-guide-query.service', () => ({
    epgGuideQueryService: {
        getProgramsForChannels: (...args: unknown[]) =>
            getProgramsForChannels(...args),
        getProgramCoverage: (...args: unknown[]) => getProgramCoverage(...args),
    },
}));

jest.mock('./epg-mapping.service', () => ({
    resolveChannelIds: (...args: unknown[]) => resolveChannelIds(...args),
    resolveChannelIdsStrict: (...args: unknown[]) =>
        resolveChannelIdsStrict(...args),
    queryByResolvedChannelIds: jest.fn(),
    handleGetEpgMapping: jest.fn(),
    handleGetEpgMappingsBatch: jest.fn(),
    handleSetEpgMapping: jest.fn(),
    handleDeleteEpgMapping: jest.fn(),
    handleSearchEpgChannels: jest.fn(),
}));

/**
 * `EPG_GET_PROGRAMS_FOR_CHANNELS` / `EPG_GET_PROGRAM_COVERAGE` apply manual
 * mappings (`resolveChannelIds`) before delegating to `epgGuideQueryService`,
 * then key the answer back by the verbatim requested id. The service keys
 * its own answer by the TRIMMED, deduplicated form of the ids it was given
 * (`normalizeGuideWindow`), so the handler must resolve the same trimmed key
 * to find that answer — these tests pin the trim mismatch, the "absent
 * means not queried" contract, and the coverage de-duplication.
 */
describe('EPG guide IPC handlers', () => {
    let EpgEvents: typeof EpgEventsType;

    const program = {
        channelId: 'xmltv.id',
        title: 'News',
        start: '2026-01-01T00:00:00.000Z',
        stop: '2026-01-01T01:00:00.000Z',
        description: null,
        category: null,
        iconUrl: null,
        rating: null,
        episodeNum: null,
    };

    beforeEach(async () => {
        jest.resetModules();
        ipcHandlers.clear();
        [getProgramsForChannels, getProgramCoverage, resolveChannelIds].forEach(
            (mock) => mock.mockReset()
        );
        resolveChannelIds.mockResolvedValue(new Map());
        resolveChannelIdsStrict.mockResolvedValue(new Map());

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

    it('applies a manual mapping before querying and keys the answer back by the requested key', async () => {
        resolveChannelIds.mockResolvedValue(new Map([['m3u-key', 'xmltv.id']]));
        getProgramsForChannels.mockResolvedValue({ 'xmltv.id': [program] });

        const result = await invoke('EPG_GET_PROGRAMS_FOR_CHANNELS', {
            channelIds: ['m3u-key'],
            fromMs: 0,
            toMs: 1,
        });

        expect(getProgramsForChannels).toHaveBeenCalledWith(
            expect.objectContaining({ channelIds: ['xmltv.id'] })
        );
        expect(result).toEqual({ 'm3u-key': [program] });
    });

    it('gives two requested keys resolving to one target their own array reference', async () => {
        resolveChannelIds.mockResolvedValue(
            new Map([
                ['a', 'xmltv.id'],
                ['b', 'xmltv.id'],
            ])
        );
        getProgramsForChannels.mockResolvedValue({ 'xmltv.id': [program] });

        const result = (await invoke('EPG_GET_PROGRAMS_FOR_CHANNELS', {
            channelIds: ['a', 'b'],
            fromMs: 0,
            toMs: 1,
        })) as Record<string, unknown[]>;

        expect(result['a']).toEqual([program]);
        expect(result['b']).toEqual([program]);
        expect(result['a']).not.toBe(result['b']);
    });

    it('trims a padded requested id to find the service answer keyed by the trimmed form', async () => {
        getProgramsForChannels.mockResolvedValue({ CNN: [program] });

        const result = await invoke('EPG_GET_PROGRAMS_FOR_CHANNELS', {
            channelIds: [' CNN '],
            fromMs: 0,
            toMs: 1,
        });

        expect(getProgramsForChannels).toHaveBeenCalledWith(
            expect.objectContaining({ channelIds: [' CNN '] })
        );
        expect(result).toEqual({ ' CNN ': [program] });
    });

    it('omits a key the service did not answer for instead of filling it with []', async () => {
        getProgramsForChannels.mockResolvedValue({});

        const result = await invoke('EPG_GET_PROGRAMS_FOR_CHANNELS', {
            channelIds: ['dropped'],
            fromMs: 0,
            toMs: 1,
        });

        expect(result).toEqual({});
    });

    it('rejects coverage when the manual-mapping lookup fails, but still answers programmes', async () => {
        resolveChannelIdsStrict.mockRejectedValue(new Error('mapping db down'));
        getProgramsForChannels.mockResolvedValue({ a: [] });

        await expect(
            invoke('EPG_GET_PROGRAM_COVERAGE', {
                channelIds: ['a'],
                fromMs: 0,
                toMs: 1,
            })
        ).rejects.toThrow('mapping db down');
        await expect(
            invoke('EPG_GET_PROGRAMS_FOR_CHANNELS', {
                channelIds: ['a'],
                fromMs: 0,
                toMs: 1,
            })
        ).resolves.toEqual({ a: [] });
    });

    it('de-duplicates requested coverage keys and keeps only the covered ones', async () => {
        getProgramCoverage.mockResolvedValue(['a']);

        const result = await invoke('EPG_GET_PROGRAM_COVERAGE', {
            channelIds: ['a', 'a', 'b'],
            fromMs: 0,
            toMs: 1,
        });

        expect(result).toEqual(['a']);
    });
});
