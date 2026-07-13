const handlers = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => ({
    ipcMain: {
        handle: jest.fn(
            (channel: string, handler: (...args: unknown[]) => unknown) => {
                handlers.set(channel, handler);
            }
        ),
    },
}));

jest.mock('../services/store.service', () => ({
    MPV_PLAYER_ARGUMENTS: 'mpvPlayerArguments',
    MPV_REUSE_INSTANCE: 'mpvReuseInstance',
    VLC_PLAYER_ARGUMENTS: 'vlcPlayerArguments',
    VLC_REUSE_INSTANCE: 'vlcReuseInstance',
    store: { get: jest.fn(), set: jest.fn() },
}));

jest.mock('../server/http-server', () => ({
    httpServer: { updateSettings: jest.fn() },
}));

describe('SETTINGS_UPDATE logging', () => {
    beforeEach(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        await import('./settings.events');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('does not print a TMDB apiKey while retaining useful fields', () => {
        const apiKey = 'tmdb-settings-api-key-secret';
        const handler = handlers.get('SETTINGS_UPDATE');

        expect(handler).toBeDefined();
        handler?.({}, { language: 'de', tmdb: { apiKey, enabled: true } });

        const output = JSON.stringify((console.log as jest.Mock).mock.calls);
        expect(output).not.toContain(apiKey);
        expect(output).toContain('language');
        expect(output).toContain('de');
        expect(output).toContain('enabled');
    });
});
