import { firstValueFrom, of } from 'rxjs';
import { DbStores, Playlist } from 'shared-interfaces';
import { PlaylistsService } from './playlists.service';

const SQLITE_PLAYLIST_MIGRATION_FLAG = 'm3u-playlists-indexeddb-to-sqlite-v1';
const STALKER_PLAYLIST_METADATA_MIGRATION_FLAG =
    'm3u-playlists-stalker-metadata-v1';

describe('PlaylistsService', () => {
    const originalElectron = (window as Window & { electron?: unknown }).electron;

    afterEach(() => {
        (window as Window & { electron?: unknown }).electron = originalElectron;
        localStorage.removeItem(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG);
        jest.restoreAllMocks();
    });

    function createService(overrides: Record<string, unknown> = {}) {
        const service = Object.create(PlaylistsService.prototype) as PlaylistsService;

        Object.assign(service as object, {
            dbService: {
                clear: jest.fn(() => of(undefined)),
                getAll: jest.fn(() => of([])),
                getByID: jest.fn(() => of(undefined)),
                update: jest.fn(() => of(undefined)),
                ...overrides,
            },
            snackBar: {
                open: jest.fn(),
            },
            translateService: {
                instant: jest.fn((key: string) => key),
            },
            electronMigrationPromise: null,
            indexedDbMigrationPromise: null,
        });

        return service;
    }

    it('migrates legacy Stalker portal flags in SQLite before returning playlists', async () => {
        let storedPlaylists: Playlist[] = [
            {
                _id: 'stalker-1',
                title: 'Legacy Stalker',
                count: 0,
                importDate: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                lastUsage: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                autoRefresh: false,
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'http://example.com/stalker_portal/c/',
            } as Playlist,
        ];
        const appState = new Map<string, string>([
            [SQLITE_PLAYLIST_MIGRATION_FLAG, '1'],
        ]);
        const electron = {
            dbGetAppPlaylists: jest.fn(async () => storedPlaylists),
            dbGetAppState: jest.fn(
                async (key: string) => appState.get(key) ?? null
            ),
            dbSetAppState: jest.fn(async (key: string, value: string) => {
                appState.set(key, value);
            }),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(async (playlists: Playlist[]) => {
                const updates = new Map(
                    playlists.map((playlist) => [playlist._id, playlist])
                );
                storedPlaylists = storedPlaylists.map(
                    (playlist) => updates.get(playlist._id) ?? playlist
                );
            }),
        };
        (window as Window & { electron?: unknown }).electron = electron;

        const service = createService();

        await expect(firstValueFrom(service.getAllPlaylists())).resolves.toEqual([
            expect.objectContaining({
                _id: 'stalker-1',
                isFullStalkerPortal: true,
            }),
        ]);

        expect(electron.dbUpsertAppPlaylists).toHaveBeenCalledWith([
            expect.objectContaining({
                _id: 'stalker-1',
                isFullStalkerPortal: true,
            }),
        ]);
        expect(appState.get(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG)).toBe('1');
    });

    it('does not rerun the SQLite Stalker metadata migration after the flag is set', async () => {
        const electron = {
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) => {
                if (
                    key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                    key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                ) {
                    return '1';
                }

                return null;
            }),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        (window as Window & { electron?: unknown }).electron = electron;

        const service = createService();

        await firstValueFrom(service.getAllPlaylists());
        await firstValueFrom(service.getAllPlaylists());

        expect(electron.dbUpsertAppPlaylists).not.toHaveBeenCalled();
        expect(electron.dbSetAppState).not.toHaveBeenCalledWith(
            STALKER_PLAYLIST_METADATA_MIGRATION_FLAG,
            '1'
        );
    });

    it('migrates legacy Stalker portal flags in IndexedDB before returning full playlists', async () => {
        let storedPlaylists: Playlist[] = [
            {
                _id: 'stalker-2',
                title: 'IndexedDB Stalker',
                count: 0,
                importDate: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                lastUsage: new Date('2026-03-28T00:00:00.000Z').toISOString(),
                autoRefresh: false,
                macAddress: '00:1A:79:11:22:33',
                portalUrl: 'http://example.com/portal/c/',
            } as Playlist,
        ];
        const dbService = {
            getAll: jest.fn(() => of(storedPlaylists)),
            update: jest.fn((_storeName: string, playlist: Playlist) => {
                storedPlaylists = storedPlaylists.map((current) =>
                    current._id === playlist._id ? playlist : current
                );
                return of(playlist);
            }),
        };
        (window as Window & { electron?: unknown }).electron = undefined;

        const service = createService(dbService);

        await expect(firstValueFrom(service.getAllData())).resolves.toEqual([
            expect.objectContaining({
                _id: 'stalker-2',
                isFullStalkerPortal: false,
            }),
        ]);

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'stalker-2',
                isFullStalkerPortal: false,
            })
        );
        expect(
            localStorage.getItem(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG)
        ).toBe('1');
    });
});
