import { firstValueFrom, of } from 'rxjs';
import { PlaylistsService } from './playlists.service';

describe('Electron legacy playlist migration', () => {
    const original = window.electron;
    afterEach(() => {
        window.electron = original;
        jest.restoreAllMocks();
    });
    function setup() {
        const playlists = [
            { _id: 'stalker-1', macAddress: '00:1A:79:00:00:01' },
            { _id: 'xtream-1', serverUrl: 'https://synthetic.invalid' },
            { _id: 'm3u-1', playlist: { items: [] } },
        ];
        const dbService = {
            getAll: jest.fn(() => of(playlists)),
            clear: jest.fn(() => of(undefined)),
        };
        const electron = {
            dbGetAppState: jest.fn(async () => null),
            dbSetAppState: jest.fn(async () => undefined),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbUpsertAppPlaylists: jest.fn(async () => ({
                success: true,
                count: playlists.length,
            })),
            dbMigrateAppPlaylists: jest.fn(async () => ({
                success: true,
                count: playlists.length,
            })),
        };
        window.electron = electron as unknown as typeof window.electron;
        const service = Object.create(
            PlaylistsService.prototype
        ) as PlaylistsService;
        Object.assign(service, {
            dbService,
            runtime: { supportsSqlite: true },
            electronMigrationPromise: null,
        });
        return { playlists, dbService, electron, service };
    }
    it('retains legacy IndexedDB and uses the atomic non-overwriting migration', async () => {
        const { playlists, dbService, electron, service } = setup();
        await firstValueFrom(service.getAllPlaylists());
        expect(electron.dbMigrateAppPlaylists).toHaveBeenCalledWith(playlists);
        expect(dbService.clear).not.toHaveBeenCalled();
        expect(electron.dbSetAppState).not.toHaveBeenCalledWith(
            'm3u-playlists-indexeddb-to-sqlite-v1',
            '1'
        );
    });
    it('retries failed migration and does not present an incomplete source list as success', async () => {
        const { electron, service } = setup();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        electron.dbMigrateAppPlaylists.mockRejectedValueOnce(
            new Error('synthetic failure')
        );
        await expect(firstValueFrom(service.getAllPlaylists())).rejects.toThrow(
            'synthetic failure'
        );
        await expect(
            firstValueFrom(service.getAllPlaylists())
        ).resolves.toEqual([]);
        expect(electron.dbMigrateAppPlaylists).toHaveBeenCalledTimes(2);
    });
});
