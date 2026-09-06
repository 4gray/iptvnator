import { EMPTY, firstValueFrom, of } from 'rxjs';
import { DbStores, Playlist, PlaylistMeta } from '@iptvnator/shared/interfaces';
import { PlaylistsService, resolvePlaylistParser } from './playlists.service';

const SQLITE_PLAYLIST_MIGRATION_FLAG = 'm3u-playlists-indexeddb-to-sqlite-v1';
const STALKER_PLAYLIST_METADATA_MIGRATION_FLAG =
    'm3u-playlists-stalker-metadata-v1';

describe('PlaylistsService', () => {
    const testWindow = window as unknown as { electron?: unknown };
    const originalElectron = testWindow.electron;
    const originalLockManager = globalThis.navigator?.locks;

    afterEach(() => {
        testWindow.electron = originalElectron;
        Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: originalLockManager,
        });
        localStorage.removeItem(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG);
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    function createService(overrides: Record<string, unknown> = {}) {
        const service = Object.create(
            PlaylistsService.prototype
        ) as PlaylistsService;

        Object.assign(service as object, {
            dbService: {
                clear: jest.fn(() => of(undefined)),
                delete: jest.fn(() => of(undefined)),
                // IndexedDB operations run the Stalker metadata migration first;
                // the default cursor represents an empty playlist store.
                getAll: jest.fn(() => of([])),
                getByID: jest.fn(() => of(undefined)),
                openCursor: jest.fn(() => EMPTY),
                update: jest.fn(() => of(undefined)),
                ...overrides,
            },
            snackBar: {
                open: jest.fn(),
            },
            translateService: {
                instant: jest.fn((key: string) => key),
            },
            runtime: {
                get supportsSqlite() {
                    const electron = testWindow.electron as
                        Record<string, unknown> | undefined;
                    return (
                        !!electron &&
                        typeof electron['dbGetAppPlaylists'] === 'function' &&
                        typeof electron['dbUpsertAppPlaylist'] === 'function' &&
                        typeof electron['dbGetAppState'] === 'function' &&
                        typeof electron['dbSetAppState'] === 'function'
                    );
                },
            },
            electronMigrationPromise: null,
            indexedDbMigrationPromise: null,
            playlistWriteQueues: new Map(),
            playlistDeleteCleanups: [],
        });

        return service;
    }

    it('resolves the parser from a CommonJS default dynamic import shape', () => {
        const parse = jest.fn();

        expect(
            resolvePlaylistParser({
                default: { parse },
            })
        ).toBe(parse);
    });

    it('runs registered cleanup hooks after deleting a browser playlist', async () => {
        const cleanup = jest.fn().mockResolvedValue(undefined);
        const deleteFromIndexedDb = jest.fn(() => of(undefined));
        const service = createService({ delete: deleteFromIndexedDb });
        Object.assign(service as object, {
            playlistDeleteCleanups: [cleanup],
        });

        await expect(
            firstValueFrom(service.deletePlaylist('playlist-1'))
        ).resolves.toEqual({ success: true });

        expect(deleteFromIndexedDb).toHaveBeenCalledWith(
            DbStores.Playlists,
            'playlist-1'
        );
        expect(cleanup).toHaveBeenCalledWith('playlist-1');
    });

    it('returns browser playlist summaries without embedded playlist payloads', async () => {
        const dbService = {
            getAll: jest.fn(() =>
                of([
                    {
                        _id: 'playlist-summary',
                        title: 'Summary Playlist',
                        count: 2,
                        importDate: '2026-04-01T00:00:00.000Z',
                        lastUsage: '2026-04-02T00:00:00.000Z',
                        autoRefresh: false,
                        favorites: ['channel-1'],
                        playlist: {
                            header: { raw: '#EXTM3U' },
                            items: [{ id: 'channel-1' }],
                        },
                        header: { raw: '#EXTM3U' },
                        items: [{ id: 'legacy-item' }],
                    } as Playlist,
                ])
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        const playlists = await firstValueFrom(service.getAllPlaylists());

        expect(playlists).toEqual([
            expect.objectContaining({
                _id: 'playlist-summary',
                title: 'Summary Playlist',
                favorites: ['channel-1'],
            }),
        ]);
        expect(playlists[0]).not.toHaveProperty('playlist');
        expect(playlists[0]).not.toHaveProperty('header');
        expect(playlists[0]).not.toHaveProperty('items');
    });

    it('loads Electron playlist summaries from the metadata-only bridge when available', async () => {
        const electron = {
            dbGetAppPlaylist: jest.fn(),
            dbGetAppPlaylistMetas: jest.fn(async () => [
                {
                    _id: 'playlist-meta',
                    title: 'Metadata Playlist',
                    count: 2,
                    favorites: ['channel-1'],
                    playlist: {
                        items: [{ id: 'channel-1' }],
                    },
                },
            ]),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                    ? '1'
                    : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();
        const playlists = await firstValueFrom(service.getAllPlaylists());

        expect(electron.dbGetAppPlaylistMetas).toHaveBeenCalledTimes(1);
        expect(electron.dbGetAppPlaylists).not.toHaveBeenCalled();
        expect(playlists).toEqual([
            expect.objectContaining({
                _id: 'playlist-meta',
                title: 'Metadata Playlist',
                favorites: ['channel-1'],
            }),
        ]);
        expect(playlists[0]).not.toHaveProperty('playlist');
    });

    it('normalizes partial SQLite playlists when loading by id', async () => {
        const electron = {
            dbGetAppPlaylist: jest.fn(async () => ({
                id: 42,
                count: '3',
                url: 'https://example.com/list.m3u',
                autoRefresh: '',
            })),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                    ? '1'
                    : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getPlaylistById('42'))
        ).resolves.toEqual(
            expect.objectContaining({
                _id: '42',
                title: '',
                count: 3,
                favorites: [],
                recentlyViewed: [],
                autoRefresh: false,
                url: 'https://example.com/list.m3u',
            })
        );
    });

    it('loads resolved M3U favorite channels from Electron without fetching the full playlist payload', async () => {
        const resolvedFavorites = [
            {
                favoriteId: 'channel-1',
                favoriteIndex: 0,
                channel: {
                    id: 'channel-1',
                    name: 'Channel One',
                    url: 'https://example.com/stream-1.m3u8',
                },
            },
        ];
        const electron = {
            dbGetAppPlaylist: jest.fn(),
            dbGetAppPlaylistFavoriteChannels: jest.fn(
                async () => resolvedFavorites
            ),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                    ? '1'
                    : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getM3uFavoriteChannels('playlist-1'))
        ).resolves.toBe(resolvedFavorites);
        expect(electron.dbGetAppState).toHaveBeenCalledWith(
            SQLITE_PLAYLIST_MIGRATION_FLAG
        );
        expect(electron.dbGetAppPlaylistFavoriteChannels).toHaveBeenCalledWith(
            'playlist-1'
        );
        expect(electron.dbGetAppPlaylist).not.toHaveBeenCalled();
        expect(electron.dbGetAppPlaylists).not.toHaveBeenCalled();
    });

    it('falls back from resolved M3U favorites when SQLite playlist migration is incomplete', async () => {
        const electron = {
            dbGetAppPlaylist: jest.fn(),
            dbGetAppPlaylistFavoriteChannels: jest.fn(),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ? null : '1'
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getM3uFavoriteChannels('playlist-1'))
        ).resolves.toBeNull();
        expect(
            electron.dbGetAppPlaylistFavoriteChannels
        ).not.toHaveBeenCalled();
        expect(electron.dbGetAppPlaylist).not.toHaveBeenCalled();
        expect(electron.dbGetAppPlaylists).not.toHaveBeenCalled();
    });

    it('adds browser playlists through IndexedDB and returns the original playlist', async () => {
        const playlist = {
            _id: 'playlist-add',
            title: 'Add Me',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
        } as Playlist;
        const dbService = {
            add: jest.fn(() => of('generated-key')),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.addPlaylist(playlist))
        ).resolves.toBe(playlist);
        expect(dbService.add).toHaveBeenCalledWith(
            DbStores.Playlists,
            playlist
        );
    });

    it('coordinates browser row replacements with the cross-context edit reservation', async () => {
        const request = jest.fn(
            async <T>(
                name: string,
                options: LockOptions,
                callback: (lock: Lock | null) => Promise<T>
            ) =>
                callback({
                    name,
                    mode: options.mode ?? 'exclusive',
                } as Lock)
        );
        Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: { request },
        });
        const playlist = {
            _id: 'playlist-replacement-lock',
            title: 'Replacement',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
        } as Playlist;
        const dbService = {
            add: jest.fn(() => of('generated-key')),
            delete: jest.fn(() => of(undefined)),
        };
        testWindow.electron = undefined;
        const service = createService(dbService);

        await firstValueFrom(service.addPlaylist(playlist));
        await firstValueFrom(service.deletePlaylist(playlist._id));

        expect(
            request.mock.calls.map(([name, options]) => [name, options])
        ).toEqual([
            ['iptvnator:playlist-authority', { mode: 'shared' }],
            [
                `iptvnator:playlist-authority:${playlist._id}`,
                { mode: 'exclusive' },
            ],
            ['iptvnator:playlist-authority', { mode: 'shared' }],
            [
                `iptvnator:playlist-authority:${playlist._id}`,
                { mode: 'exclusive' },
            ],
        ]);
    });

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
        testWindow.electron = electron;

        const service = createService();

        await expect(
            firstValueFrom(service.getAllPlaylists())
        ).resolves.toEqual([
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
        expect(appState.get(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG)).toBe(
            '1'
        );
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
        testWindow.electron = electron;

        const service = createService();

        await firstValueFrom(service.getAllPlaylists());
        await firstValueFrom(service.getAllPlaylists());

        expect(electron.dbUpsertAppPlaylists).not.toHaveBeenCalled();
        expect(electron.dbSetAppState).not.toHaveBeenCalledWith(
            STALKER_PLAYLIST_METADATA_MIGRATION_FLAG,
            '1'
        );
    });

    it('migrates legacy Stalker portal flags in one IndexedDB cursor transaction', async () => {
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
        const cursorUpdate = jest.fn((playlist: Playlist) => {
            storedPlaylists = [playlist];
        });
        const cursorContinue = jest.fn();
        const dbService = {
            getAll: jest.fn(() => of(storedPlaylists)),
            openCursor: jest.fn(() =>
                of({
                    value: storedPlaylists[0],
                    update: cursorUpdate,
                    continue: cursorContinue,
                })
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(firstValueFrom(service.getAllData())).resolves.toEqual([
            expect.objectContaining({
                _id: 'stalker-2',
                isFullStalkerPortal: false,
            }),
        ]);

        expect(dbService.openCursor).toHaveBeenCalledWith({
            storeName: DbStores.Playlists,
            mode: 'readwrite',
        });
        expect(cursorUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'stalker-2',
                isFullStalkerPortal: false,
            })
        );
        expect(cursorContinue).toHaveBeenCalledTimes(1);
        expect(dbService.getAll).toHaveBeenCalledTimes(1);
        expect(
            localStorage.getItem(STALKER_PLAYLIST_METADATA_MIGRATION_FLAG)
        ).toBe('1');
    });

    it('carries the Stalker session fields through the SQLite fallback read', async () => {
        // Without these, every cold Electron session loses the persisted
        // cadence AND the identity the token was negotiated for — so the
        // mismatch check cannot run and the watchdog falls back to default.
        const electron = {
            dbGetAppPlaylist: jest.fn(async () => ({
                id: 'stalker-1',
                stalkerToken: 'TOKEN',
                stalkerSessionIdentity: 'fingerprint-1',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 7,
            })),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async () => '1'),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();
        const playlist = await firstValueFrom(
            service.getPlaylistById('stalker-1')
        );

        expect(playlist).toEqual(
            expect.objectContaining({
                stalkerToken: 'TOKEN',
                stalkerSessionIdentity: 'fingerprint-1',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 7,
            })
        );
    });

    it('clears a stale watchdog cadence when the portal stops advertising one', async () => {
        // Reusing the token skips the profile that would correct the cadence,
        // so leaving the old value on the row means the next restart applies
        // a cadence the portal no longer asks for.
        const existingPlaylist: Playlist = {
            _id: 'stalker-1',
            title: 'Stalker',
            count: 0,
            importDate: new Date('2026-08-02T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-08-02T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            stalkerToken: 'OLD',
            stalkerWatchdogTimeout: 45,
            stalkerTimeslot: 7,
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updateStalkerSession('stalker-1', { stalkerToken: 'NEW' })
        );

        const written = dbService.update.mock.calls[0][1] as Playlist;
        expect(written.stalkerToken).toBe('NEW');
        expect(written.stalkerWatchdogTimeout).toBeUndefined();
        expect(written.stalkerTimeslot).toBeUndefined();
    });

    it('persists the watchdog cadence alongside the stalker token', async () => {
        const existingPlaylist: Playlist = {
            _id: 'stalker-1',
            title: 'Stalker',
            count: 0,
            importDate: new Date('2026-08-02T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-08-02T00:00:00.000Z').toISOString(),
            autoRefresh: false,
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updateStalkerSession('stalker-1', {
                stalkerToken: 'TOKEN',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 12,
            })
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                stalkerToken: 'TOKEN',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 12,
            })
        );
    });

    it('persists hiddenGroupTitles in playlist meta updates', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-1',
            title: 'Playlist One',
            count: 2,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            hiddenGroupTitles: ['News'],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updatePlaylistMeta({
                _id: 'playlist-1',
                hiddenGroupTitles: ['Movies', 'Sports'],
            } as PlaylistMeta)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-1',
                hiddenGroupTitles: ['Movies', 'Sports'],
            })
        );
    });

    it('drops the learned panel timezone when a metadata update points the source at another server (issue #1562)', async () => {
        const existingPlaylist = {
            _id: 'xtream-1',
            title: 'Portal',
            serverUrl: 'https://old.example.com',
            username: 'user',
            password: 'pass',
            serverTimezone: 'Europe/London',
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;
        const service = createService(dbService);

        await firstValueFrom(
            service.updatePlaylistMeta({
                _id: 'xtream-1',
                title: 'Portal',
                serverUrl: 'https://new.example.com',
            } as PlaylistMeta)
        );
        const [, moved] = dbService.update.mock.calls[0];
        expect(moved.serverUrl).toBe('https://new.example.com');
        expect(moved.serverTimezone).toBeUndefined();

        dbService.update.mockClear();
        await firstValueFrom(
            service.updatePlaylistMeta({
                _id: 'xtream-1',
                title: 'Renamed portal',
                serverUrl: 'https://old.example.com',
            } as PlaylistMeta)
        );
        const [, renamed] = dbService.update.mock.calls[0];
        expect(renamed.serverTimezone).toBe('Europe/London');

        dbService.update.mockClear();
        await firstValueFrom(
            service.updatePlaylistMeta({
                _id: 'xtream-1',
                title: 'Portal',
                serverUrl: 'https://new.example.com',
                serverTimezone: 'UTC+03:00',
            } as PlaylistMeta)
        );
        const [, relearned] = dbService.update.mock.calls[0];
        expect(relearned.serverTimezone).toBe('UTC+03:00');
    });

    it('aborts a guarded metadata update in one readwrite transaction when the row no longer matches', async () => {
        const replacementPlaylist = {
            _id: 'stalker-replaced',
            title: 'Restored Portal',
            portalUrl: 'https://restored.example.com/portal.php',
        } as Playlist;
        const cursorUpdate = jest.fn();
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(),
            update: jest.fn(),
            openCursor: jest.fn(() =>
                of({
                    value: replacementPlaylist,
                    update: cursorUpdate,
                })
            ),
        };
        testWindow.electron = undefined;
        const service = createService(dbService);

        await expect(
            firstValueFrom(
                service.updatePlaylistMetaIfCurrent(
                    {
                        _id: replacementPlaylist._id,
                        portalUrl: 'https://late.example.com/server/load.php',
                    } as PlaylistMeta,
                    (current) =>
                        current.portalUrl ===
                        'https://original.example.com/portal.php'
                )
            )
        ).resolves.toBeNull();

        expect(dbService.openCursor).toHaveBeenCalledWith({
            storeName: DbStores.Playlists,
            query: replacementPlaylist._id,
            mode: 'readwrite',
        });
        expect(cursorUpdate).not.toHaveBeenCalled();
        expect(dbService.getByID).not.toHaveBeenCalled();
        expect(dbService.update).not.toHaveBeenCalled();
    });

    it('merges and commits a matching guarded browser update through its cursor', async () => {
        const currentPlaylist = {
            _id: 'stalker-guarded-write',
            title: 'Original Portal',
            portalUrl: 'https://original.example.com/portal.php',
            macAddress: '00:1A:79:00:00:01',
        } as Playlist;
        const cursorUpdate = jest.fn();
        const dbService = {
            getAll: jest.fn(() => of([])),
            openCursor: jest.fn(() =>
                of({
                    value: currentPlaylist,
                    update: cursorUpdate,
                })
            ),
        };
        testWindow.electron = undefined;
        const service = createService(dbService);

        const result = await firstValueFrom(
            service.updatePlaylistMetaIfCurrent(
                {
                    _id: currentPlaylist._id,
                    portalUrl: 'https://resolved.example.com/server/load.php',
                    stalkerSessionPatch: null,
                } as never,
                (current) => current.portalUrl === currentPlaylist.portalUrl
            )
        );

        expect(cursorUpdate).toHaveBeenCalledWith(result);
        expect(result).toEqual(
            expect.objectContaining({
                title: currentPlaylist.title,
                portalUrl: 'https://resolved.example.com/server/load.php',
                macAddress: currentPlaylist.macAddress,
                stalkerToken: undefined,
            })
        );
    });

    it('commits a browser conditional transform through the same readwrite cursor', async () => {
        const currentPlaylist = {
            _id: 'stalker-cursor-write',
            title: 'Original Portal',
            portalUrl: 'https://original.example.com/portal.php',
        } as Playlist;
        const cursorUpdate = jest.fn();
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(),
            update: jest.fn(),
            openCursor: jest.fn(() =>
                of({
                    value: currentPlaylist,
                    update: cursorUpdate,
                })
            ),
        };
        testWindow.electron = undefined;
        const service = createService(dbService);

        const result = await firstValueFrom(
            service.transformPlaylistMeta(currentPlaylist._id, (current) => ({
                ...current,
                portalUrl: 'https://resolved.example.com/server/load.php',
            }))
        );

        expect(dbService.openCursor).toHaveBeenCalledWith({
            storeName: DbStores.Playlists,
            query: currentPlaylist._id,
            mode: 'readwrite',
        });
        expect(cursorUpdate).toHaveBeenCalledWith(result);
        expect(result?.portalUrl).toBe(
            'https://resolved.example.com/server/load.php'
        );
        expect(dbService.getByID).not.toHaveBeenCalled();
        expect(dbService.update).not.toHaveBeenCalled();
    });

    describe('Stalker session patches in playlist meta updates', () => {
        function createStalkerPlaylist(): Playlist {
            return {
                _id: 'stalker-session-patch',
                title: 'Stalker Portal',
                count: 0,
                importDate: '2026-08-08T00:00:00.000Z',
                lastUsage: '2026-08-08T00:00:00.000Z',
                autoRefresh: false,
                stalkerToken: 'OLD_TOKEN',
                stalkerSessionIdentity: 'old-fingerprint',
                stalkerWatchdogTimeout: 120,
                stalkerTimeslot: 15,
                stalkerAccountInfo: {
                    login: 'old-login',
                    expireDate: 1800000000,
                },
            };
        }

        it('preserves the current session when the transient patch is absent', async () => {
            const existingPlaylist = createStalkerPlaylist();
            const dbService = {
                getAll: jest.fn(() => of([])),
                getByID: jest.fn(() => of(existingPlaylist)),
                update: jest.fn((_storeName: string, playlist: Playlist) =>
                    of(playlist)
                ),
            };
            testWindow.electron = undefined;
            const service = createService(dbService);

            await firstValueFrom(
                service.updatePlaylistMeta({
                    _id: existingPlaylist._id,
                    title: 'Renamed Portal',
                } as PlaylistMeta)
            );

            expect(dbService.update.mock.calls[0][1]).toEqual(
                expect.objectContaining({
                    stalkerToken: 'OLD_TOKEN',
                    stalkerSessionIdentity: 'old-fingerprint',
                    stalkerWatchdogTimeout: 120,
                    stalkerTimeslot: 15,
                    stalkerAccountInfo: existingPlaylist.stalkerAccountInfo,
                })
            );
        });

        it('clears every stored session field when the transient patch is null', async () => {
            const existingPlaylist = createStalkerPlaylist();
            const dbService = {
                getAll: jest.fn(() => of([])),
                getByID: jest.fn(() => of(existingPlaylist)),
                update: jest.fn((_storeName: string, playlist: Playlist) =>
                    of(playlist)
                ),
            };
            testWindow.electron = undefined;
            const service = createService(dbService);

            await firstValueFrom(
                service.updatePlaylistMeta({
                    _id: existingPlaylist._id,
                    stalkerSessionPatch: null,
                } as never)
            );

            const written = dbService.update.mock.calls[0][1];
            expect(written.stalkerToken).toBeUndefined();
            expect(written.stalkerSessionIdentity).toBeUndefined();
            expect(written.stalkerWatchdogTimeout).toBeUndefined();
            expect(written.stalkerTimeslot).toBeUndefined();
            expect(written.stalkerAccountInfo).toBeUndefined();
            expect(written).not.toHaveProperty('stalkerSessionPatch');
        });

        it('fully replaces session metadata without persisting the transient patch', async () => {
            const existingPlaylist = createStalkerPlaylist();
            const dbService = {
                getAll: jest.fn(() => of([])),
                getByID: jest.fn(() => of(existingPlaylist)),
                update: jest.fn((_storeName: string, playlist: Playlist) =>
                    of(playlist)
                ),
            };
            testWindow.electron = undefined;
            const service = createService(dbService);

            await firstValueFrom(
                service.updatePlaylistMeta({
                    _id: existingPlaylist._id,
                    stalkerSessionPatch: {
                        stalkerToken: 'NEW_TOKEN',
                        stalkerSessionIdentity: 'new-fingerprint',
                        stalkerWatchdogTimeout: 90,
                    },
                } as never)
            );

            const written = dbService.update.mock.calls[0][1];
            expect(written).toEqual(
                expect.objectContaining({
                    stalkerToken: 'NEW_TOKEN',
                    stalkerSessionIdentity: 'new-fingerprint',
                    stalkerWatchdogTimeout: 90,
                })
            );
            expect(written.stalkerTimeslot).toBeUndefined();
            expect(written.stalkerAccountInfo).toBeUndefined();
            expect(written).not.toHaveProperty('stalkerSessionPatch');
        });
    });

    it('updates many browser playlists with refresh metadata', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1770000000000);
        // Auto-refresh snapshots always come from playlists that had
        // autoRefresh enabled; the batch write preserves that flag from the
        // current row (or the snapshot when the row is missing) instead of
        // force-enabling it.
        const playlists = [
            {
                _id: 'playlist-a',
                title: 'A',
                count: 1,
                importDate: '2026-04-01T00:00:00.000Z',
                lastUsage: '2026-04-01T00:00:00.000Z',
                autoRefresh: true,
            },
            {
                _id: 'playlist-b',
                title: 'B',
                count: 2,
                importDate: '2026-04-01T00:00:00.000Z',
                lastUsage: '2026-04-01T00:00:00.000Z',
                autoRefresh: true,
            },
        ] as Playlist[];
        const dbService = {
            getAll: jest.fn(() => of([])),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.updateManyPlaylists(playlists))
        ).resolves.toHaveLength(2);

        expect(dbService.update).toHaveBeenNthCalledWith(
            1,
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-a',
                updateDate: 1770000000000,
                autoRefresh: true,
            })
        );
        expect(dbService.update).toHaveBeenNthCalledWith(
            2,
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-b',
                updateDate: 1770000000000,
                autoRefresh: true,
            })
        );
    });

    it('short-circuits updateManyPlaylists when no playlists are provided', async () => {
        const dbService = {
            update: jest.fn(),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.updateManyPlaylists([]))
        ).resolves.toEqual([]);
        expect(dbService.update).not.toHaveBeenCalled();
    });

    it('filters favorite channels from a playlist payload', async () => {
        const playlist = {
            _id: 'playlist-favorites',
            title: 'Favorites',
            count: 3,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: ['channel-2', 'channel-3'],
            playlist: {
                items: [
                    { id: 'channel-1', name: 'One' },
                    { id: 'channel-2', name: 'Two' },
                    { id: 'channel-3', name: 'Three' },
                ],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getFavoriteChannels('playlist-favorites'))
        ).resolves.toEqual([
            expect.objectContaining({ id: 'channel-2' }),
            expect.objectContaining({ id: 'channel-3' }),
        ]);
    });

    it('sorts portal favorites newest first', async () => {
        const playlist = {
            _id: 'portal-1',
            title: 'Portal',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: [
                { id: 'old', title: 'Old', added_at: '2026-04-01T10:00:00Z' },
                { id: 'new', title: 'New', added_at: '2026-04-01T11:00:00Z' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getPortalFavorites('portal-1'))
        ).resolves.toEqual([
            expect.objectContaining({ id: 'new' }),
            expect.objectContaining({ id: 'old' }),
        ]);
    });

    it('filters portal live stream favorites', async () => {
        const playlist = {
            _id: 'portal-live',
            title: 'Portal Live',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: [
                { stream_id: 1, title: 'Live', stream_type: 'live' },
                { movie_id: 2, title: 'Movie', stream_type: 'movie' },
                { id: 3, title: 'No Type' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getPortalLiveStreamFavorites('portal-live'))
        ).resolves.toEqual([expect.objectContaining({ stream_id: 1 })]);
    });

    it('removes portal favorites by any supported identity field', async () => {
        const playlist = {
            _id: 'portal-remove-favorite',
            title: 'Portal Remove',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            favorites: [
                { stream_id: 10, title: 'Live' },
                { series_id: 20, title: 'Series' },
                { movie_id: 30, title: 'Movie' },
                { id: 40, title: 'Other' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
            update: jest.fn((_storeName: string, updated: Playlist) =>
                of(updated)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPortalFavorites('portal-remove-favorite', 20)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                favorites: [
                    expect.objectContaining({ stream_id: 10 }),
                    expect.objectContaining({ movie_id: 30 }),
                    expect.objectContaining({ id: 40 }),
                ],
            })
        );
    });

    it('updates browser playlist positions through individual reads and writes', async () => {
        const playlistsById = new Map<string, Playlist>([
            [
                'playlist-position-a',
                {
                    _id: 'playlist-position-a',
                    title: 'Position A',
                    count: 0,
                    importDate: '2026-04-01T00:00:00.000Z',
                    lastUsage: '2026-04-01T00:00:00.000Z',
                    autoRefresh: false,
                    position: 1,
                } as Playlist,
            ],
            [
                'playlist-position-b',
                {
                    _id: 'playlist-position-b',
                    title: 'Position B',
                    count: 0,
                    importDate: '2026-04-01T00:00:00.000Z',
                    lastUsage: '2026-04-01T00:00:00.000Z',
                    autoRefresh: false,
                    position: 2,
                } as Playlist,
            ],
        ]);
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn((_storeName: string, id: string) =>
                of(playlistsById.get(id))
            ),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(
                service.updatePlaylistPositions([
                    { id: 'playlist-position-a', changes: { position: 2 } },
                    { id: 'playlist-position-b', changes: { position: 1 } },
                ])
            )
        ).resolves.toEqual([
            expect.objectContaining({
                _id: 'playlist-position-a',
                position: 2,
            }),
            expect.objectContaining({
                _id: 'playlist-position-b',
                position: 1,
            }),
        ]);
    });

    it('returns only auto-refresh playlists as lightweight metadata', async () => {
        const dbService = {
            getAll: jest.fn(() =>
                of([
                    {
                        _id: 'manual',
                        title: 'Manual',
                        count: 1,
                        importDate: '2026-04-01T00:00:00.000Z',
                        lastUsage: '2026-04-01T00:00:00.000Z',
                        autoRefresh: false,
                    } as Playlist,
                    {
                        _id: 'auto',
                        title: 'Auto',
                        count: 1,
                        importDate: '2026-04-01T00:00:00.000Z',
                        lastUsage: '2026-04-01T00:00:00.000Z',
                        autoRefresh: true,
                        favorites: ['channel-1'],
                        playlist: {
                            header: { raw: '#EXTM3U' },
                            items: [{ id: 'channel-1' }],
                        },
                    } as Playlist,
                ])
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        const autoUpdatePlaylists = await firstValueFrom(
            service.getPlaylistsForAutoUpdate()
        );

        expect(autoUpdatePlaylists).toEqual([
            expect.objectContaining({
                _id: 'auto',
                autoRefresh: true,
            }),
        ]);
        expect(autoUpdatePlaylists[0]).not.toHaveProperty('playlist');
        expect(autoUpdatePlaylists[0]).not.toHaveProperty('favorites');
    });

    it('exports raw playlist text from header and item raw lines', async () => {
        const playlist = {
            _id: 'playlist-raw',
            title: 'Raw',
            count: 2,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            playlist: {
                header: { raw: '#EXTM3U' },
                items: [
                    { raw: '#EXTINF:-1,One\nhttps://example.com/one.m3u8' },
                    { raw: '#EXTINF:-1,Two\nhttps://example.com/two.m3u8' },
                ],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.getRawPlaylistById('playlist-raw'))
        ).resolves.toBe(
            '#EXTM3U\n' +
                '#EXTINF:-1,One\nhttps://example.com/one.m3u8\n' +
                '#EXTINF:-1,Two\nhttps://example.com/two.m3u8'
        );
    });

    it('clears all browser playlists', async () => {
        const dbService = {
            clear: jest.fn(() => of('cleared')),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.removeAll())
        ).resolves.toBeUndefined();
        expect(dbService.clear).toHaveBeenCalledWith(DbStores.Playlists);
    });

    it('takes the exclusive cross-context authority barrier before clearing playlists', async () => {
        const request = jest.fn(
            async <T>(
                name: string,
                options: LockOptions,
                callback: (lock: Lock | null) => Promise<T>
            ) =>
                callback({
                    name,
                    mode: options.mode ?? 'exclusive',
                } as Lock)
        );
        Object.defineProperty(globalThis.navigator, 'locks', {
            configurable: true,
            value: { request },
        });
        const dbService = {
            clear: jest.fn(() => of('cleared')),
        };
        testWindow.electron = undefined;
        const service = createService(dbService);

        await firstValueFrom(service.removeAll());

        expect(request).toHaveBeenCalledWith(
            'iptvnator:playlist-authority',
            { mode: 'exclusive' },
            expect.any(Function)
        );
    });

    it('adds many browser playlists through bulkAdd', async () => {
        const playlists = [
            {
                _id: 'bulk-a',
                title: 'Bulk A',
                count: 0,
                importDate: '2026-04-01T00:00:00.000Z',
                lastUsage: '2026-04-01T00:00:00.000Z',
                autoRefresh: false,
            },
        ] as Playlist[];
        const dbService = {
            bulkAdd: jest.fn(() => of(['bulk-a'])),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(service.addManyPlaylists(playlists))
        ).resolves.toEqual(['bulk-a']);
        expect(dbService.bulkAdd).toHaveBeenCalledWith(
            DbStores.Playlists,
            playlists
        );
    });

    it('removes multiple recently-viewed identities in a single PWA write', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-3',
            title: 'Playlist Three',
            count: 3,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'https://example.com/1.m3u8',
                    url: 'https://example.com/1.m3u8',
                    title: 'A',
                    category_id: 'live',
                    added_at: '2026-05-04T10:00:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'https://example.com/2.m3u8',
                    url: 'https://example.com/2.m3u8',
                    title: 'B',
                    category_id: 'live',
                    added_at: '2026-05-04T10:01:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'https://example.com/3.m3u8',
                    url: 'https://example.com/3.m3u8',
                    title: 'C',
                    category_id: 'live',
                    added_at: '2026-05-04T10:02:00.000Z',
                },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPlaylistRecentlyViewedBatch('playlist-3', [
                'https://example.com/1.m3u8',
                'https://example.com/2.m3u8',
            ])
        );

        expect(dbService.update).toHaveBeenCalledTimes(1);
        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-3',
                recentlyViewed: [
                    expect.objectContaining({
                        url: 'https://example.com/3.m3u8',
                    }),
                ],
            })
        );
    });

    it('removes multiple recently-viewed identities in a single Electron upsert', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-4',
            title: 'Playlist Four',
            count: 0,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'https://example.com/a.m3u8',
                    url: 'https://example.com/a.m3u8',
                    title: 'A',
                    category_id: 'live',
                    added_at: '2026-05-04T10:00:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'https://example.com/b.m3u8',
                    url: 'https://example.com/b.m3u8',
                    title: 'B',
                    category_id: 'live',
                    added_at: '2026-05-04T10:01:00.000Z',
                },
            ],
        } as Playlist;
        const electron = {
            dbGetAppPlaylist: jest.fn(async () => existingPlaylist),
            dbGetAppPlaylists: jest.fn(async () => []),
            dbGetAppState: jest.fn(async (key: string) =>
                key === SQLITE_PLAYLIST_MIGRATION_FLAG ? '1' : null
            ),
            dbSetAppState: jest.fn(),
            dbUpsertAppPlaylist: jest.fn(async () => undefined),
            dbUpsertAppPlaylists: jest.fn(),
        };
        testWindow.electron = electron;

        const service = createService();

        await firstValueFrom(
            service.removeFromPlaylistRecentlyViewedBatch('playlist-4', [
                'https://example.com/a.m3u8',
                'https://example.com/b.m3u8',
            ])
        );

        expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledTimes(1);
        expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'playlist-4',
                recentlyViewed: [],
            })
        );
    });

    it('short-circuits removeFromPlaylistRecentlyViewedBatch when identities is empty', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-5',
            title: 'Playlist Five',
            count: 0,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            recentlyViewed: [],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPlaylistRecentlyViewedBatch('playlist-5', [])
        );

        expect(dbService.update).not.toHaveBeenCalled();
    });

    it('sorts recently viewed entries by normalized date', async () => {
        const playlist = {
            _id: 'playlist-recent-sort',
            title: 'Recent Sort',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'old',
                    url: 'https://example.com/old.m3u8',
                    title: 'Old',
                    category_id: 'live',
                    added_at: '2026-04-01T10:00:00.000Z',
                },
                {
                    id: 'new',
                    title: 'New',
                    added_at: '2026-04-01 11:00:00',
                },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await expect(
            firstValueFrom(
                service.getPlaylistRecentlyViewed('playlist-recent-sort')
            )
        ).resolves.toEqual([
            expect.objectContaining({ id: 'new' }),
            expect.objectContaining({ id: 'old' }),
        ]);
    });

    it('updates an existing M3U recently viewed item instead of duplicating it', async () => {
        jest.useFakeTimers().setSystemTime(
            new Date('2026-04-02T12:00:00.000Z')
        );
        const playlist = {
            _id: 'playlist-recent-m3u',
            title: 'Recent M3U',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            recentlyViewed: [
                {
                    source: 'm3u',
                    id: 'channel-old-id',
                    url: 'https://example.com/channel.m3u8',
                    title: 'Old Title',
                    group_title: 'News',
                    category_id: 'live',
                    added_at: '2026-04-01T10:00:00.000Z',
                },
                {
                    source: 'm3u',
                    id: 'other',
                    url: 'https://example.com/other.m3u8',
                    title: 'Other',
                    category_id: 'live',
                    added_at: '2026-04-01T09:00:00.000Z',
                },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
            update: jest.fn((_storeName: string, updated: Playlist) =>
                of(updated)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.addM3uRecentlyViewed('playlist-recent-m3u', {
                source: 'm3u',
                id: 'channel-new-id',
                url: 'https://example.com/channel.m3u8',
                title: 'New Title',
                channel_id: 'channel-new-id',
                category_id: 'live',
                added_at: 'ignored',
            })
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                recentlyViewed: [
                    expect.objectContaining({
                        id: 'channel-new-id',
                        title: 'New Title',
                        group_title: 'News',
                        added_at: '2026-04-02T12:00:00.000Z',
                    }),
                    expect.objectContaining({
                        url: 'https://example.com/other.m3u8',
                    }),
                ],
            })
        );
    });

    it('removes portal recently viewed items using normalized colon identities', async () => {
        const playlist = {
            _id: 'portal-recent-remove',
            title: 'Portal Recent Remove',
            count: 0,
            importDate: '2026-04-01T00:00:00.000Z',
            lastUsage: '2026-04-01T00:00:00.000Z',
            autoRefresh: false,
            recentlyViewed: [
                { id: '100:episode', title: 'Remove Me' },
                { movie_id: '200', title: 'Keep Me' },
            ],
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(playlist)),
            update: jest.fn((_storeName: string, updated: Playlist) =>
                of(updated)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.removeFromPortalRecentlyViewed('portal-recent-remove', 100)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                recentlyViewed: [expect.objectContaining({ movie_id: '200' })],
            })
        );
    });

    it('keeps hiddenGroupTitles when refreshing a playlist payload', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-2',
            title: 'Playlist Two',
            count: 1,
            importDate: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-11T00:00:00.000Z').toISOString(),
            autoRefresh: false,
            hiddenGroupTitles: ['Radio-de'],
            playlist: {
                items: [{ id: 'channel-1' }],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updatePlaylist('playlist-2', {
                _id: 'playlist-2',
                playlist: {
                    items: [],
                },
            } as Playlist)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-2',
                hiddenGroupTitles: ['Radio-de'],
                count: 0,
            })
        );
    });

    it('keeps autoRefresh enabled when refreshing a playlist payload with the parser default disabled', async () => {
        const existingPlaylist: Playlist = {
            _id: 'playlist-3',
            title: 'Playlist Three',
            count: 1,
            importDate: new Date('2026-04-12T00:00:00.000Z').toISOString(),
            lastUsage: new Date('2026-04-12T00:00:00.000Z').toISOString(),
            autoRefresh: true,
            playlist: {
                items: [{ id: 'channel-1' }],
            },
        } as Playlist;
        const dbService = {
            getAll: jest.fn(() => of([])),
            getByID: jest.fn(() => of(existingPlaylist)),
            update: jest.fn((_storeName: string, playlist: Playlist) =>
                of(playlist)
            ),
        };
        testWindow.electron = undefined;

        const service = createService(dbService);

        await firstValueFrom(
            service.updatePlaylist('playlist-3', {
                _id: 'playlist-3',
                autoRefresh: false,
                playlist: {
                    items: [],
                },
            } as Playlist)
        );

        expect(dbService.update).toHaveBeenCalledWith(
            DbStores.Playlists,
            expect.objectContaining({
                _id: 'playlist-3',
                autoRefresh: true,
                count: 0,
            })
        );
    });

    describe('per-playlist write serialization', () => {
        function createBasePlaylist(id: string): Playlist {
            return {
                _id: id,
                title: 'Race Playlist',
                count: 0,
                importDate: '2026-07-01T00:00:00.000Z',
                lastUsage: '2026-07-01T00:00:00.000Z',
                autoRefresh: false,
                favorites: [{ stream_id: 1, title: 'Existing Favorite' }],
                recentlyViewed: [],
            } as Playlist;
        }

        function createStatefulElectronStore(initialPlaylist: Playlist) {
            const store = { current: initialPlaylist };
            const electron = {
                dbGetAppPlaylist: jest.fn(async () => {
                    // Yield a microtask so overlapping reads interleave the
                    // same way real async IPC reads do.
                    await Promise.resolve();
                    return store.current;
                }),
                dbGetAppPlaylists: jest.fn(async () => []),
                dbGetAppState: jest.fn(async (key: string) =>
                    key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                    key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                        ? '1'
                        : null
                ),
                dbSetAppState: jest.fn(),
                dbUpsertAppPlaylist: jest.fn(async (playlist: Playlist) => {
                    store.current = playlist;
                }),
                dbUpsertAppPlaylists: jest.fn(async (playlists: Playlist[]) => {
                    const target = playlists.find(
                        (playlist) => playlist._id === store.current._id
                    );
                    if (target) {
                        store.current = target;
                    }
                }),
                dbDeletePlaylist: jest.fn(async () => {
                    store.current = undefined as unknown as Playlist;
                }),
            };
            return { store, electron };
        }

        it('keeps both changes when a favorite add overlaps a recently-viewed add (SQLite)', async () => {
            const { store, electron } = createStatefulElectronStore(
                createBasePlaylist('portal-race-cross-field')
            );
            testWindow.electron = electron;

            const service = createService();

            await Promise.all([
                firstValueFrom(
                    service.addPortalFavorite('portal-race-cross-field', {
                        stream_id: 2,
                        title: 'New Favorite',
                    } as never)
                ),
                firstValueFrom(
                    service.addPlaylistRecentlyViewed(
                        'portal-race-cross-field',
                        {
                            source: 'm3u',
                            id: 'https://example.com/recent.m3u8',
                            url: 'https://example.com/recent.m3u8',
                            title: 'Recent Channel',
                            category_id: 'live',
                            added_at: '2026-07-25T10:00:00.000Z',
                        } as never
                    )
                ),
            ]);

            expect(store.current.favorites).toEqual([
                expect.objectContaining({ stream_id: 1 }),
                expect.objectContaining({ stream_id: 2 }),
            ]);
            expect(store.current.recentlyViewed).toEqual([
                expect.objectContaining({
                    url: 'https://example.com/recent.m3u8',
                }),
            ]);
            expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledTimes(2);
        });

        it('forwards refresh instrumentation only to its SQLite read and write', async () => {
            const { electron } = createStatefulElectronStore(
                createBasePlaylist('playlist-instrumented-refresh')
            );
            testWindow.electron = electron;
            const service = createService();
            const operationId = 'playlist-refresh-operation';

            await firstValueFrom(
                service.updatePlaylist(
                    'playlist-instrumented-refresh',
                    {
                        _id: 'playlist-instrumented-refresh',
                        playlist: { items: [] },
                    } as Playlist,
                    operationId
                )
            );

            expect(electron.dbGetAppPlaylist).toHaveBeenCalledWith(
                'playlist-instrumented-refresh',
                operationId
            );
            expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: 'playlist-instrumented-refresh',
                }),
                operationId
            );
        });

        it('keeps both favorites when two rapid favorite adds overlap (SQLite)', async () => {
            const { store, electron } = createStatefulElectronStore(
                createBasePlaylist('portal-race-two-favorites')
            );
            testWindow.electron = electron;

            const service = createService();

            await Promise.all([
                firstValueFrom(
                    service.addPortalFavorite('portal-race-two-favorites', {
                        stream_id: 2,
                        title: 'Second Favorite',
                    } as never)
                ),
                firstValueFrom(
                    service.addPortalFavorite('portal-race-two-favorites', {
                        stream_id: 3,
                        title: 'Third Favorite',
                    } as never)
                ),
            ]);

            expect(store.current.favorites).toEqual([
                expect.objectContaining({ stream_id: 1 }),
                expect.objectContaining({ stream_id: 2 }),
                expect.objectContaining({ stream_id: 3 }),
            ]);
            expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledTimes(2);
        });

        it('keeps both changes when mutations overlap in the IndexedDB path', async () => {
            const store = {
                current: createBasePlaylist('portal-race-indexeddb'),
            };
            const dbService = {
                getAll: jest.fn(() => of([])),
                getByID: jest.fn(() => of(store.current)),
                update: jest.fn((_storeName: string, playlist: Playlist) => {
                    store.current = playlist;
                    return of(playlist);
                }),
            };
            testWindow.electron = undefined;

            const service = createService(dbService);

            await Promise.all([
                firstValueFrom(
                    service.addPortalFavorite('portal-race-indexeddb', {
                        stream_id: 2,
                        title: 'New Favorite',
                    } as never)
                ),
                firstValueFrom(
                    service.addPlaylistRecentlyViewed('portal-race-indexeddb', {
                        source: 'm3u',
                        id: 'https://example.com/recent.m3u8',
                        url: 'https://example.com/recent.m3u8',
                        title: 'Recent Channel',
                        category_id: 'live',
                        added_at: '2026-07-25T10:00:00.000Z',
                    } as never)
                ),
            ]);

            expect(store.current.favorites).toEqual([
                expect.objectContaining({ stream_id: 1 }),
                expect.objectContaining({ stream_id: 2 }),
            ]);
            expect(store.current.recentlyViewed).toEqual([
                expect.objectContaining({
                    url: 'https://example.com/recent.m3u8',
                }),
            ]);
            expect(dbService.update).toHaveBeenCalledTimes(2);
        });

        it('continues the per-playlist queue after a failed mutation', async () => {
            const { store, electron } = createStatefulElectronStore(
                createBasePlaylist('portal-race-error')
            );
            electron.dbGetAppPlaylist.mockRejectedValueOnce(
                new Error('read failed')
            );
            testWindow.electron = electron;

            const service = createService();

            const failing = firstValueFrom(
                service.addPortalFavorite('portal-race-error', {
                    stream_id: 2,
                    title: 'Dropped Favorite',
                } as never)
            );
            const following = firstValueFrom(
                service.addPortalFavorite('portal-race-error', {
                    stream_id: 3,
                    title: 'Surviving Favorite',
                } as never)
            );

            await expect(failing).rejects.toThrow('read failed');
            await following;

            expect(store.current.favorites).toEqual([
                expect.objectContaining({ stream_id: 1 }),
                expect.objectContaining({ stream_id: 3 }),
            ]);
            expect(electron.dbUpsertAppPlaylist).toHaveBeenCalledTimes(1);
        });

        it('serializes deletion behind queued writes so nothing resurrects the row', async () => {
            const { store, electron } = createStatefulElectronStore(
                createBasePlaylist('portal-delete-race')
            );
            testWindow.electron = electron;
            const service = createService();

            // A conditional transform (the repair's write path) is queued
            // when the user deletes the playlist: the delete must run AFTER
            // the queued write, leaving the row deleted — not upserted back.
            await Promise.all([
                firstValueFrom(
                    service.transformPlaylistMeta(
                        'portal-delete-race',
                        (current) => ({
                            ...current,
                            portalUrl: 'http://x/portal.php',
                        })
                    )
                ),
                firstValueFrom(service.deletePlaylist('portal-delete-race')),
            ]);

            expect(store.current).toBeUndefined();
            const upsertOrder =
                electron.dbUpsertAppPlaylist.mock.invocationCallOrder[0];
            const deleteOrder =
                electron.dbDeletePlaylist.mock.invocationCallOrder[0];
            expect(deleteOrder).toBeGreaterThan(upsertOrder);
        });

        it('transformPlaylistMeta aborts without writing when the transform returns null', async () => {
            const { electron } = createStatefulElectronStore(
                createBasePlaylist('portal-meta-abort')
            );
            testWindow.electron = electron;
            const service = createService();
            const writesBefore = electron.dbUpsertAppPlaylist.mock.calls.length;

            const result = await firstValueFrom(
                service.transformPlaylistMeta('portal-meta-abort', () => null)
            );

            expect(result).toBeNull();
            expect(electron.dbUpsertAppPlaylist.mock.calls.length).toBe(
                writesBefore
            );
        });

        it('transformPlaylistMeta persists the transformed row and serializes with queued edits', async () => {
            const { store, electron } = createStatefulElectronStore(
                createBasePlaylist('portal-meta-write')
            );
            testWindow.electron = electron;
            const service = createService();

            // A queued edit commits first; the conditional transform then
            // sees ITS result — the property the Stalker portal repair
            // relies on to never overwrite a user edit racing the probe.
            await Promise.all([
                firstValueFrom(
                    service.updatePlaylistMeta({
                        _id: 'portal-meta-write',
                        title: 'Edited Title',
                    } as never)
                ),
                firstValueFrom(
                    service.transformPlaylistMeta(
                        'portal-meta-write',
                        (current) =>
                            current.title === 'Edited Title'
                                ? {
                                      ...current,
                                      portalUrl: 'http://x/portal.php',
                                  }
                                : null
                    )
                ),
            ]);

            expect(store.current.title).toBe('Edited Title');
            expect(store.current.portalUrl).toBe('http://x/portal.php');
        });

        it('applies overlapping favorites transforms atomically', async () => {
            const { store, electron } = createStatefulElectronStore(
                createBasePlaylist('portal-transform-race')
            );
            testWindow.electron = electron;

            const service = createService();

            await Promise.all([
                firstValueFrom(
                    service.transformPlaylistFavorites(
                        'portal-transform-race',
                        (current) => [
                            ...current,
                            { stream_id: 2, title: 'Second' } as never,
                        ]
                    )
                ),
                firstValueFrom(
                    service.transformPlaylistFavorites(
                        'portal-transform-race',
                        (current) => [
                            ...current,
                            { stream_id: 3, title: 'Third' } as never,
                        ]
                    )
                ),
            ]);

            expect(store.current.favorites).toEqual([
                expect.objectContaining({ stream_id: 1 }),
                expect.objectContaining({ stream_id: 2 }),
                expect.objectContaining({ stream_id: 3 }),
            ]);
        });

        it('keeps a queued favorite add when an auto-refresh batch write overlaps', async () => {
            const { store, electron } = createStatefulElectronStore({
                ...createBasePlaylist('portal-refresh-race'),
                autoRefresh: true,
            } as Playlist);
            testWindow.electron = electron;

            const service = createService();
            const staleRefreshSnapshot = {
                ...createBasePlaylist('portal-refresh-race'),
                autoRefresh: true,
                title: 'Refreshed Title',
                count: 42,
                recentlyViewed: [],
            } as Playlist;

            await Promise.all([
                firstValueFrom(
                    service.addPortalFavorite('portal-refresh-race', {
                        stream_id: 2,
                        title: 'New Favorite',
                    } as never)
                ),
                firstValueFrom(
                    service.updateManyPlaylists([staleRefreshSnapshot])
                ),
            ]);

            expect(store.current.title).toBe('Refreshed Title');
            expect(store.current.autoRefresh).toBe(true);
            expect(store.current.favorites).toEqual([
                expect.objectContaining({ stream_id: 1 }),
                expect.objectContaining({ stream_id: 2 }),
            ]);
        });

        it('does not re-enable auto-refresh disabled while a batch refresh is in flight', async () => {
            const { store, electron } = createStatefulElectronStore({
                ...createBasePlaylist('portal-autorefresh-race'),
                autoRefresh: true,
            } as Playlist);
            testWindow.electron = electron;

            const service = createService();
            const staleRefreshSnapshot = {
                ...createBasePlaylist('portal-autorefresh-race'),
                autoRefresh: true,
                title: 'Refreshed Title',
            } as Playlist;

            await Promise.all([
                firstValueFrom(
                    service.updatePlaylistMeta({
                        _id: 'portal-autorefresh-race',
                        autoRefresh: false,
                    } as PlaylistMeta)
                ),
                firstValueFrom(
                    service.updateManyPlaylists([staleRefreshSnapshot])
                ),
            ]);

            expect(store.current.autoRefresh).toBe(false);
            expect(store.current.title).toBe('Refreshed Title');
        });

        it('keeps queued metadata changes when an auto-refresh batch write overlaps', async () => {
            const { store, electron } = createStatefulElectronStore({
                ...createBasePlaylist('portal-meta-race'),
                hiddenGroupTitles: ['News'],
                manualEpgUrls: ['https://example.com/manual.xml'],
            } as Playlist);
            testWindow.electron = electron;

            const service = createService();
            const staleRefreshSnapshot = {
                ...createBasePlaylist('portal-meta-race'),
                title: 'Refreshed Title',
                playlist: { items: [{ id: 'channel-1' }] },
            } as Playlist;

            await Promise.all([
                firstValueFrom(
                    service.updatePlaylistMeta({
                        _id: 'portal-meta-race',
                        hiddenGroupTitles: ['News', 'Movies'],
                    } as PlaylistMeta)
                ),
                firstValueFrom(
                    service.updateManyPlaylists([staleRefreshSnapshot])
                ),
            ]);

            expect(store.current.hiddenGroupTitles).toEqual(['News', 'Movies']);
            expect(store.current.manualEpgUrls).toEqual([
                'https://example.com/manual.xml',
            ]);
            expect(store.current.title).toBe('Refreshed Title');
            expect(store.current.count).toBe(1);
        });

        it('keeps a queued favorite add when a position update overlaps', async () => {
            const { store, electron } = createStatefulElectronStore(
                createBasePlaylist('portal-position-race')
            );
            testWindow.electron = electron;

            const service = createService();

            await Promise.all([
                firstValueFrom(
                    service.addPortalFavorite('portal-position-race', {
                        stream_id: 2,
                        title: 'New Favorite',
                    } as never)
                ),
                firstValueFrom(
                    service.updatePlaylistPositions([
                        {
                            id: 'portal-position-race',
                            changes: { position: 7 },
                        },
                    ])
                ),
            ]);

            expect(store.current.position).toBe(7);
            expect(store.current.favorites).toEqual([
                expect.objectContaining({ stream_id: 1 }),
                expect.objectContaining({ stream_id: 2 }),
            ]);
        });

        it('does not serialize mutations across different playlists', async () => {
            const playlists = new Map<string, Playlist>([
                ['portal-a', createBasePlaylist('portal-a')],
                ['portal-b', createBasePlaylist('portal-b')],
            ]);
            let resolvePortalARead: (() => void) | undefined;
            const portalARead = new Promise<void>((resolve) => {
                resolvePortalARead = resolve;
            });
            const electron = {
                dbGetAppPlaylist: jest.fn(async (playlistId: string) => {
                    if (playlistId === 'portal-a') {
                        await portalARead;
                    }
                    return playlists.get(playlistId);
                }),
                dbGetAppPlaylists: jest.fn(async () => []),
                dbGetAppState: jest.fn(async (key: string) =>
                    key === SQLITE_PLAYLIST_MIGRATION_FLAG ||
                    key === STALKER_PLAYLIST_METADATA_MIGRATION_FLAG
                        ? '1'
                        : null
                ),
                dbSetAppState: jest.fn(),
                dbUpsertAppPlaylist: jest.fn(async (playlist: Playlist) => {
                    playlists.set(playlist._id, playlist);
                }),
                dbUpsertAppPlaylists: jest.fn(),
            };
            testWindow.electron = electron;

            const service = createService();

            const blockedPortalA = firstValueFrom(
                service.addPortalFavorite('portal-a', {
                    stream_id: 2,
                    title: 'Portal A Favorite',
                } as never)
            );

            // Portal B completes although portal A's read is still blocked.
            await firstValueFrom(
                service.addPortalFavorite('portal-b', {
                    stream_id: 5,
                    title: 'Portal B Favorite',
                } as never)
            );
            expect(playlists.get('portal-b')?.favorites).toHaveLength(2);

            resolvePortalARead?.();
            await blockedPortalA;
            expect(playlists.get('portal-a')?.favorites).toHaveLength(2);
        });
    });
});
