import { TestBed } from '@angular/core/testing';
import { PlaylistStorageBackend } from './playlist-storage-backend';
import { RuntimeCapabilitiesService } from './runtime-capabilities.service';

describe('PlaylistStorageBackend', () => {
    const testWindow = window as unknown as { electron?: unknown };
    const originalElectron = testWindow.electron;

    afterEach(() => {
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
});
