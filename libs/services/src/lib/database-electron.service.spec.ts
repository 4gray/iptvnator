import { DatabaseService } from './database-electron.service';

describe('DatabaseService browser guards', () => {
    const originalElectron = window.electron;
    let service: DatabaseService;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: undefined,
        });
        consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        service = new DatabaseService();
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    it('treats app state persistence as unavailable without the Electron bridge', async () => {
        await expect(service.getAppState('xtream-key')).resolves.toBeNull();
        await expect(
            service.setAppState('xtream-key', 'completed')
        ).resolves.toBe(false);
        await expect(
            service.getXtreamImportStatus('playlist-1', 'movie')
        ).resolves.toBe('idle');
        await expect(
            service.setXtreamImportStatus('playlist-1', 'movie', 'completed')
        ).resolves.toBe(false);
        await expect(
            service.getContentByXtreamId(20229, 'playlist-1', 'movie')
        ).resolves.toBeNull();

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
