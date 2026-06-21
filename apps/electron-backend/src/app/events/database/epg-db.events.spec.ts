const getDatabase = jest.fn();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(),
    },
}));

jest.mock('../../database/connection', () => ({
    getDatabase: (...args: unknown[]) => getDatabase(...args),
}));

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
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(async () => {
        jest.resetModules();
        getDatabase.mockReset();
        const { ipcMain } = jest.requireMock('electron') as {
            ipcMain: { handle: jest.Mock };
        };
        ipcMain.handle.mockClear();
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

        await import('./epg-db.events');
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it('clears a source in a single database transaction', async () => {
        const runOrder: string[] = [];
        const txDelete = jest
            .fn()
            .mockReturnValueOnce({
                where: jest.fn(() => ({
                    run: jest.fn(() => runOrder.push('programs')),
                })),
            })
            .mockReturnValueOnce({
                where: jest.fn(() => ({
                    run: jest.fn(() => runOrder.push('channels')),
                })),
            });
        const transaction = jest.fn((callback: (tx: unknown) => void) =>
            callback({ delete: txDelete })
        );
        getDatabase.mockResolvedValue({ transaction });

        await expect(
            getIpcMainHandler('EPG_DB_CLEAR_SOURCE')(
                {},
                'https://playlist.example.com/guide.xml'
            )
        ).resolves.toEqual({ success: true });

        expect(transaction).toHaveBeenCalledTimes(1);
        expect(txDelete).toHaveBeenCalledTimes(2);
        expect(runOrder).toEqual(['programs', 'channels']);
    });
});
