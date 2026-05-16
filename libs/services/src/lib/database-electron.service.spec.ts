import { DatabaseService } from './database-electron.service';

describe('DatabaseService', () => {
    let service: DatabaseService;
    let originalElectron: typeof window.electron;

    const setElectron = (electron: typeof window.electron | undefined) => {
        (window as unknown as { electron?: typeof window.electron }).electron =
            electron;
    };

    beforeEach(() => {
        service = new DatabaseService();
        originalElectron = window.electron;
    });

    afterEach(() => {
        setElectron(originalElectron);
        jest.restoreAllMocks();
    });

    it('skips Electron app-state reads when the preload API is unavailable', async () => {
        setElectron(undefined);

        await expect(service.getAppState('key')).resolves.toBeNull();
    });

    it('skips Electron app-state writes when the preload API is unavailable', async () => {
        setElectron(undefined);

        await expect(service.setAppState('key', 'value')).resolves.toBe(false);
    });

    it('delegates Electron app-state calls when the preload API is available', async () => {
        setElectron({
            dbGetAppState: jest.fn().mockResolvedValue('stored'),
            dbSetAppState: jest.fn().mockResolvedValue(undefined),
        } as unknown as typeof window.electron);

        await expect(service.getAppState('key')).resolves.toBe('stored');
        await expect(service.setAppState('key', 'value')).resolves.toBe(true);
        expect(window.electron.dbGetAppState).toHaveBeenCalledWith('key');
        expect(window.electron.dbSetAppState).toHaveBeenCalledWith(
            'key',
            'value'
        );
    });
});
