const mockRequest = jest.fn();
const mockDialog = jest.fn();
const mockRead = jest.fn();
const mockDestroy = jest.fn();
const mockAccess = jest.fn();
const mockCopy = jest.fn();
const mockRemove = jest.fn();

jest.mock('electron', () => ({
    app: {
        getPath: (key: string) =>
            key === 'appData' ? '/synthetic' : '/synthetic/current',
        commandLine: { hasSwitch: () => false },
    },
    dialog: { showMessageBox: (...args: unknown[]) => mockDialog(...args) },
    session: { fromPath: () => ({}) },
    BrowserWindow: jest.fn(() => ({
        loadFile: async () => undefined,
        destroy: mockDestroy,
        webContents: { executeJavaScript: mockRead },
    })),
}));
jest.mock('fs/promises', () => ({
    access: (...args: unknown[]) => mockAccess(...args),
    cp: (...args: unknown[]) => mockCopy(...args),
    mkdtemp: async () => '/synthetic/snapshot',
    writeFile: async () => undefined,
    rm: (...args: unknown[]) => mockRemove(...args),
}));
jest.mock('../database/connection', () => ({ getDatabase: async () => ({}) }));
jest.mock('./database-worker-client', () => ({
    databaseWorkerClient: {
        request: (...args: unknown[]) => mockRequest(...args),
    },
}));

const key = 'playlists-electron-backend-profile-v1';
describe('optional legacy profile recovery', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockAccess.mockResolvedValue(undefined);
        mockCopy.mockResolvedValue(undefined);
        mockRemove.mockResolvedValue(undefined);
        mockRequest.mockResolvedValue(null);
        mockDialog.mockResolvedValue({ response: 0 });
        mockRead.mockResolvedValue([{ _id: 'synthetic-source' }]);
    });
    it('defaults to keeping current sources and never opens the legacy DB before consent', async () => {
        const { recoverLegacyProfile } =
            await import('./legacy-profile-recovery');
        await recoverLegacyProfile();
        expect(mockDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                defaultId: 0,
                cancelId: 0,
                detail: expect.stringContaining('intentionally deleted'),
            })
        );
        expect(mockCopy).not.toHaveBeenCalled();
        expect(mockRequest).toHaveBeenCalledWith('DB_SET_APP_STATE', {
            key,
            value: 'declined',
        });
    });
    it('reads a disposable copy only after consent and commits through the worker', async () => {
        mockDialog.mockResolvedValue({ response: 1 });
        const { recoverLegacyProfile } =
            await import('./legacy-profile-recovery');
        await recoverLegacyProfile();
        expect(mockDialog.mock.invocationCallOrder[0]).toBeLessThan(
            mockCopy.mock.invocationCallOrder[0]
        );
        expect(mockCopy).toHaveBeenCalledWith(
            '/synthetic/electron-backend/IndexedDB',
            '/synthetic/snapshot/IndexedDB',
            { recursive: true, dereference: true }
        );
        expect(mockRequest).toHaveBeenCalledWith('DB_MIGRATE_APP_PLAYLISTS', {
            key,
            playlists: [{ _id: 'synthetic-source' }],
        });
        expect(mockDestroy).toHaveBeenCalled();
        expect(mockRemove).toHaveBeenCalled();
    });
    it('keeps current sources usable on a corrupt legacy read, without a successful receipt', async () => {
        const warning = jest
            .spyOn(console, 'warn')
            .mockImplementation(() => undefined);
        mockDialog.mockResolvedValue({ response: 1 });
        mockRead.mockRejectedValueOnce(new Error('synthetic corruption'));
        const { recoverLegacyProfile } =
            await import('./legacy-profile-recovery');
        await expect(recoverLegacyProfile()).resolves.toBeUndefined();
        expect(mockRequest).not.toHaveBeenCalledWith(
            'DB_MIGRATE_APP_PLAYLISTS',
            expect.anything()
        );
        expect(mockRequest).not.toHaveBeenCalledWith(
            'DB_SET_APP_STATE',
            expect.anything()
        );
        expect(mockDialog).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: 'error' })
        );
        warning.mockRestore();
    });
    it('never reimports completed recovery, including after source deletion', async () => {
        mockRequest.mockResolvedValue('1');
        const { recoverLegacyProfile } =
            await import('./legacy-profile-recovery');
        await recoverLegacyProfile();
        expect(mockDialog).not.toHaveBeenCalled();
        expect(mockCopy).not.toHaveBeenCalled();
    });
    it('bounds a stalled reader and destroys it without committing a receipt', async () => {
        jest.useFakeTimers();
        mockRead.mockReturnValueOnce(new Promise(() => undefined));
        const { readLegacyProfilePlaylists } =
            await import('./legacy-profile-recovery');
        const read = readLegacyProfilePlaylists('/synthetic/electron-backend');
        const rejected = expect(read).rejects.toThrow('Legacy read timed out');
        await jest.advanceTimersByTimeAsync(15000);
        await rejected;
        expect(mockDestroy).toHaveBeenCalled();
        expect(mockRemove).toHaveBeenCalled();
        expect(mockRequest).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});
