import { TestBed } from '@angular/core/testing';
import { PlaylistStorageBackend } from './playlist-storage-backend';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';
import {
    sourceConnection,
    sourceConnectionReadFailed,
} from './source-sync/source-connection';

jest.mock('./source-sync/source-connection', () => ({
    sourceConnection: jest.fn(() => null),
    sourceConnectionReadFailed: jest.fn(() => false),
}));

describe('PlaylistStorageBackend', () => {
    const testWindow = window as unknown as { electron?: unknown };
    const originalElectron = testWindow.electron;

    afterEach(() => {
        (sourceConnection as jest.Mock).mockReturnValue(null);
        (sourceConnectionReadFailed as jest.Mock).mockReturnValue(false);
        testWindow.electron = originalElectron;
        TestBed.resetTestingModule();
    });

    function create(supportsSqlite: boolean) {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsSqlite },
                },
            ],
        });
        return TestBed.inject(PlaylistStorageBackend);
    }

    it('uses the Electron bridge when the SQLite bridge is complete', () => {
        const bridge = { dbGetAppPlaylists: jest.fn() };
        testWindow.electron = bridge;

        const backend = create(true);

        expect(backend.kind()).toBe('electron');
        expect(backend.documentStore()).toBe(bridge);
    });

    it('uses IndexedDB without the SQLite bridge', () => {
        testWindow.electron = { dbGetAppPlaylists: jest.fn() };

        const backend = create(false);

        expect(backend.kind()).toBe('indexeddb');
        expect(backend.documentStore()).toBeNull();
    });

    it('rejects inventory reads during configuration recovery without opening the standalone store', async () => {
        (sourceConnectionReadFailed as jest.Mock).mockReturnValue(true);
        const bridge = { dbGetAppPlaylists: jest.fn() };
        testWindow.electron = bridge;
        const backend = create(true);
        expect(backend.kind()).toBe('server');
        backend.finishServerInitialization();
        await expect(
            backend.documentStore()!.dbGetAppPlaylists()
        ).rejects.toThrow('SOURCE_SYNC.OFFLINE');
        expect(bridge.dbGetAppPlaylists).not.toHaveBeenCalled();
    });

    it('selects server authority before early settings reads and waits for its first projection', async () => {
        (sourceConnection as jest.Mock).mockReturnValue({
            apiUrl: 'https://nas.test/api',
            instanceId: 'nas',
        });
        const backend = create(true);
        expect(backend.kind()).toBe('server');
        const get = jest.fn(async () => []);
        let settled = false;
        const pending = backend
            .documentStore()!
            .dbGetAppPlaylists()
            .then(() => {
                settled = true;
            });
        await Promise.resolve();
        expect(settled).toBe(false);
        backend.installServerStore({ dbGetAppPlaylists: get } as never);
        expect(get).not.toHaveBeenCalled();
        backend.finishServerInitialization();
        await pending;
        expect(get).toHaveBeenCalledTimes(1);
    });
    it('prefers the server store once it is set', () => {
        testWindow.electron = undefined;
        const backend = create(false);
        const store = { dbGetAppPlaylists: jest.fn() } as never;

        backend.useServerStore(store);

        expect(backend.kind()).toBe('server');
        expect(backend.documentStore()).toBe(store);
    });
});
