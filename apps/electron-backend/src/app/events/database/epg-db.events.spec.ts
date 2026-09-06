const getDatabase = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('../../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

function getRegisteredChannels(): string[] {
    const { ipcMain } = jest.requireMock('electron') as {
        ipcMain: { handle: jest.Mock };
    };
    return (
        ipcMain.handle.mock.calls as Array<
            [string, (...args: unknown[]) => unknown]
        >
    ).map(([registeredChannel]) => registeredChannel);
}

function getIpcMainHandler(channel: string): (...args: unknown[]) => unknown {
    const { ipcMain } = jest.requireMock('electron') as {
        ipcMain: { handle: jest.Mock };
    };
    const calls = ipcMain.handle.mock.calls as Array<
        [string, (...args: unknown[]) => unknown]
    >;
    const match = calls.find(
        ([registeredChannel]) => registeredChannel === channel
    );

    if (!match) {
        throw new Error(`Missing ipcMain handler for ${channel}`);
    }

    return match[1];
}

describe('epg-db.events', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(async () => {
        jest.resetModules();
        getDatabase.mockReset();
        const { ipcMain } = jest.requireMock('electron') as {
            ipcMain: { handle: jest.Mock };
        };
        ipcMain.handle.mockClear();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        await import('./epg-db.events');
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('registers only the programme-search channel', () => {
        // Every other EPG persistence/lookup path lives in the EPG worker and
        // epg-query.service.ts; the removed EPG_DB_* handlers must not return.
        expect(getRegisteredChannels()).toEqual(['EPG_DB_SEARCH_PROGRAMS']);
    });

    it('returns an empty result for a blank search term without querying', async () => {
        const all = jest.fn();
        getDatabase.mockResolvedValue({ all });

        await expect(
            getIpcMainHandler('EPG_DB_SEARCH_PROGRAMS')({}, '   ')
        ).resolves.toEqual([]);

        expect(all).not.toHaveBeenCalled();
    });

    it('searches programmes with a LIKE pattern built from the trimmed term', async () => {
        const rows = [
            {
                channel_id: 'nhk.jp',
                start: '2026-09-06T16:00:00.000Z',
                stop: '2026-09-06T16:30:00.000Z',
                title: 'News',
                description: 'Evening bulletin',
                category: 'news',
                icon_url: 'https://x/icon.png',
                rating: null,
                episode_num: 'S1E2',
                channel_name: 'NHK',
            },
        ];
        const all = jest.fn().mockResolvedValue(rows);
        getDatabase.mockResolvedValue({ all });

        // Raw snake_case columns become the public `EpgProgram` shape.
        await expect(
            getIpcMainHandler('EPG_DB_SEARCH_PROGRAMS')({}, '  news  ', 25)
        ).resolves.toEqual([
            {
                start: '2026-09-06T16:00:00.000Z',
                stop: '2026-09-06T16:30:00.000Z',
                channel: 'nhk.jp',
                title: 'News',
                desc: 'Evening bulletin',
                category: 'news',
                iconUrl: 'https://x/icon.png',
                rating: null,
                episodeNum: 'S1E2',
                channelName: 'NHK',
            },
        ]);

        expect(all).toHaveBeenCalledTimes(1);
        const query = all.mock.calls[0][0] as {
            queryChunks?: unknown[];
        };
        const boundParams = JSON.stringify(query);
        expect(boundParams).toContain('%news%');
        expect(boundParams).toContain('25');
    });
});
