import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
} from '@iptvnator/shared/interfaces';
import {
    createPlaylistBackupService,
    createPwaXtreamBackupState,
} from './playlist-backup.service.test-helpers';
import { existingXtreamPlaylist } from './playlist-backup.xtream-fixtures';
import { PwaXtreamBackupStateService } from './pwa-xtream-backup-state.service';
import {
    USER_DATA_STORAGE,
    UserDataStorage,
    XTREAM_USER_DATA_KEYS,
} from './user-data-storage';

/**
 * The browser build keeps Xtream favorites, history, positions and title
 * snapshots in USER_DATA_STORAGE rather than SQLite. These specs run the
 * backup with no Electron bridge, against the maps exactly as
 * `PwaXtreamDataSource` writes them.
 */
describe('PlaylistBackupService Xtream user state in the PWA', () => {
    const KEYS = XTREAM_USER_DATA_KEYS;
    const otherPlaylist = {
        ...existingXtreamPlaylist,
        _id: 'xtream-2',
        title: 'Other Portal',
        serverUrl: 'http://other.example.com',
        username: 'other',
    } as Playlist;
    const heat = {
        id: 501,
        xtream_id: 501,
        type: 'movie',
        title: 'Heat',
        poster_url: 'https://img.example.com/heat.jpg',
        backdrop_url: 'https://img.example.com/heat-wide.jpg',
    };
    // Written under a bare id by builds that predate typed keys.
    const legacyShow = { id: 77, xtream_id: 77, type: 'series', title: 'Show' };
    const position = {
        contentXtreamId: 501,
        contentType: 'vod',
        positionSeconds: 120,
        durationSeconds: 3600,
        playlistId: 'xtream-1',
        updatedAt: '2026-07-05T20:00:00.000Z',
    };

    beforeEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
        TestBed.resetTestingModule();
    });

    function seed(storage: UserDataStorage = localStorage): void {
        const write = (key: string, value: unknown) =>
            storage.setItem(key, JSON.stringify(value));
        write(KEYS.favorites, {
            // 88 is a bare id no snapshot identifies: live, movie or series.
            'xtream-1': ['movie:501', 77, 88],
            'xtream-2': ['live:9'],
        });
        write(KEYS.recentItems, {
            'xtream-1': [
                { id: 'live:601', viewedAt: '2026-07-04T18:30:00.000Z' },
                {
                    id: 'movie:501',
                    viewedAt: '2026-07-01T10:00:00.000Z',
                    backdropUrl: 'https://img.example.com/heat-old.jpg',
                },
                {
                    id: 'movie:501',
                    viewedAt: '2026-07-03T10:00:00.000Z',
                    // Saved by an older build in snake_case.
                    backdrop_url: 'https://img.example.com/heat-still.jpg',
                },
            ],
            'xtream-2': [
                { id: 'live:9', viewedAt: '2026-07-02T10:00:00.000Z' },
            ],
        });
        write(KEYS.collectionItems, {
            'xtream-1': {
                'movie:501': heat,
                '77': legacyShow,
                'movie:999': { xtream_id: 999, type: 'movie', title: 'Gone' },
            },
            'xtream-2': { 'live:9': { xtream_id: 9, type: 'live' } },
        });
        write(KEYS.playbackPositions, {
            'xtream-1': [position],
            'xtream-2': [{ ...position, playlistId: 'xtream-2' }],
        });
    }

    function read(key: string, storage: UserDataStorage = localStorage) {
        return JSON.parse(storage.getItem(key) ?? 'null');
    }

    function pendingRestore(service: object) {
        return (
            service as unknown as {
                pendingRestoreService: {
                    getOrThrow(playlistId: string): unknown;
                    set(playlistId: string, state: unknown): unknown;
                };
            }
        ).pendingRestoreService;
    }

    function xtreamOnly(manifest: PlaylistBackupManifestV1) {
        return JSON.stringify({
            ...manifest,
            playlists: [xtreamEntry(manifest)],
        });
    }

    function playlistsService(playlists: Playlist[]) {
        return {
            getAllData: jest.fn(() => of(playlists)),
            addPlaylist: jest.fn((playlist: Playlist) => of(playlist)),
            getRawPlaylistById: jest.fn(() => of('#EXTM3U')),
        };
    }

    function xtreamEntry(
        manifest: PlaylistBackupManifestV1,
        exportedId = 'xtream-1'
    ): XtreamPlaylistBackupEntry {
        return manifest.playlists.find(
            (entry) => entry.exportedId === exportedId
        ) as XtreamPlaylistBackupEntry;
    }

    async function exportSeeded(): Promise<PlaylistBackupManifestV1> {
        seed();
        const service = createPlaylistBackupService({
            playlistsService: playlistsService([
                existingXtreamPlaylist,
                otherPlaylist,
            ]),
        });
        return (await service.exportBackup()).manifest;
    }

    describe('export', () => {
        it('writes each playlist its own favorites, history, positions and snapshots', async () => {
            const manifest = await exportSeeded();

            expect(xtreamEntry(manifest).userState).toEqual({
                hiddenCategories: [],
                favorites: [
                    { contentType: 'movie', xtreamId: 501 },
                    { contentType: 'series', xtreamId: 77 },
                ],
                // One row per title, its newest view.
                recentlyViewed: [
                    {
                        contentType: 'live',
                        xtreamId: 601,
                        viewedAt: '2026-07-04T18:30:00.000Z',
                    },
                    {
                        contentType: 'movie',
                        xtreamId: 501,
                        viewedAt: '2026-07-03T10:00:00.000Z',
                        // The history's own artwork, ahead of the snapshot's.
                        backdropUrl: 'https://img.example.com/heat-still.jpg',
                    },
                ],
                playbackPositions: [position],
                // Only what the lists reference, not every cached title.
                collectionItems: [heat, legacyShow],
            });
            expect(xtreamEntry(manifest, 'xtream-2').userState).toEqual({
                hiddenCategories: [],
                favorites: [{ contentType: 'live', xtreamId: 9 }],
                recentlyViewed: [
                    {
                        contentType: 'live',
                        xtreamId: 9,
                        viewedAt: '2026-07-02T10:00:00.000Z',
                    },
                ],
                playbackPositions: [{ ...position, playlistId: 'xtream-2' }],
                collectionItems: [{ xtream_id: 9, type: 'live' }],
            });
            // No pin store in the browser: absent, never an authoritative [].
            expect(xtreamEntry(manifest).userState).not.toHaveProperty(
                'sourcePins'
            );
        });

        it('exports empty collections and no snapshots for a playlist with nothing stored', async () => {
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });

            const { manifest } = await service.exportBackup();

            expect(xtreamEntry(manifest).userState).toEqual({
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            });
            expect(xtreamEntry(manifest).userState).not.toHaveProperty(
                'collectionItems'
            );
        });

        it('exports a parked restore as it is instead of the stored lists', async () => {
            seed();
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });
            const parked = {
                hiddenCategories: [],
                favorites: [{ contentType: 'series' as const, xtreamId: 3 }],
                recentlyViewed: [],
                playbackPositions: [],
            };
            pendingRestore(service).set('xtream-1', parked);

            const { manifest } = await service.exportBackup();

            expect(xtreamEntry(manifest).userState).toEqual(parked);
        });

        it.each([
            ['malformed JSON', '{"xtream-1": ['],
            ['a value that is not a map', '["movie:501"]'],
            [
                'a playlist entry that is not a list',
                '{"xtream-1": "movie:501"}',
            ],
        ])('refuses to export when the favorites hold %s', async (_, raw) => {
            seed();
            localStorage.setItem(KEYS.favorites, raw);
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });

            await expect(service.exportBackup()).rejects.toThrow(
                /xtream-favorites.*unreadable/
            );
        });

        it('refuses to export when the storage itself cannot be read', async () => {
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: () => {
                        throw new DOMException('denied', 'SecurityError');
                    },
                    setItem: jest.fn(),
                    removeItem: jest.fn(),
                }),
            });

            await expect(service.exportBackup()).rejects.toThrow('denied');
        });
    });

    describe('import', () => {
        it('restores every list under the id the playlist is imported as', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            // The same portal, already present under another id: a merge.
            const local = { ...existingXtreamPlaylist, _id: 'local-xtream' };
            localStorage.setItem(
                KEYS.favorites,
                JSON.stringify({
                    'local-xtream': ['live:1'],
                    unrelated: ['movie:5'],
                })
            );
            localStorage.setItem(
                KEYS.collectionItems,
                JSON.stringify({
                    'local-xtream': {
                        'live:1': { xtream_id: 1, type: 'live' },
                    },
                })
            );
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([local]),
            });
            const summary = await service.importBackup(xtreamOnly(manifest));

            expect(summary).toMatchObject({ merged: 1, failed: 0 });
            // The archive's lists replace the playlist's; others stay put.
            expect(read(KEYS.favorites)).toEqual({
                'local-xtream': ['movie:501', 'series:77'],
                unrelated: ['movie:5'],
            });
            expect(read(KEYS.recentItems)).toEqual({
                'local-xtream': [
                    { id: 'live:601', viewedAt: '2026-07-04T18:30:00.000Z' },
                    {
                        id: 'movie:501',
                        viewedAt: '2026-07-03T10:00:00.000Z',
                        backdropUrl: 'https://img.example.com/heat-still.jpg',
                    },
                ],
            });
            expect(read(KEYS.playbackPositions)).toEqual({
                'local-xtream': [{ ...position, playlistId: 'local-xtream' }],
            });
            // Snapshots are a cache: merged, keyed by typed identity.
            expect(read(KEYS.collectionItems)).toEqual({
                'local-xtream': {
                    'live:1': { xtream_id: 1, type: 'live' },
                    'movie:501': heat,
                    'series:77': legacyShow,
                },
            });
            // Applied at once, so nothing is left for the store to replay.
            expect(
                pendingRestore(service).getOrThrow('local-xtream')
            ).toBeNull();
        });

        it('round-trips the stored lists through export and import', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([]),
            });

            const summary = await service.importBackup(
                JSON.stringify(manifest)
            );
            expect(summary).toMatchObject({ imported: 2, failed: 0 });
            const reexport = createPlaylistBackupService({
                playlistsService: playlistsService([
                    existingXtreamPlaylist,
                    otherPlaylist,
                ]),
            });

            const { manifest: again } = await reexport.exportBackup();

            expect(xtreamEntry(again).userState).toEqual(
                xtreamEntry(manifest).userState
            );
            expect(xtreamEntry(again, 'xtream-2').userState).toEqual(
                xtreamEntry(manifest, 'xtream-2').userState
            );
        });

        it('leaves snapshots alone for an archive without any, and skips damaged ones', async () => {
            const manifest = await exportSeeded();
            const entry = xtreamEntry(manifest);
            const before = read(KEYS.collectionItems);
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });

            const withoutSnapshots = {
                ...manifest,
                playlists: [
                    {
                        ...entry,
                        userState: {
                            ...entry.userState,
                            collectionItems: undefined,
                        },
                    },
                ],
            };
            await service.importBackup(JSON.stringify(withoutSnapshots));
            expect(read(KEYS.collectionItems)).toEqual(before);

            const damaged = {
                ...manifest,
                playlists: [
                    {
                        ...entry,
                        userState: {
                            ...entry.userState,
                            collectionItems: [
                                null,
                                { xtream_id: 5, type: 'radio' },
                                { xtream_id: '6', type: 'movie' },
                            ],
                        },
                    },
                ],
            };
            const summary = await service.importBackup(JSON.stringify(damaged));
            expect(summary.failed).toBe(0);
            expect(read(KEYS.collectionItems)).toEqual(before);
        });

        it('drops entries no runtime could address', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            const entry = xtreamEntry(manifest);
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });
            const hostile = {
                ...manifest,
                playlists: [
                    {
                        ...entry,
                        userState: {
                            ...entry.userState,
                            favorites: [
                                { contentType: 'radio', xtreamId: 1 },
                                { contentType: 'movie', xtreamId: -4 },
                                { contentType: 'movie', xtreamId: 501 },
                                { contentType: 'movie', xtreamId: '501' },
                            ],
                            recentlyViewed: [
                                { contentType: 'live', xtreamId: 601 },
                            ],
                            playbackPositions: [
                                { contentXtreamId: 501, contentType: 'vod' },
                                { ...position, updatedAt: undefined },
                            ],
                        },
                    },
                ],
            };

            await service.importBackup(JSON.stringify(hostile));

            expect(read(KEYS.favorites)).toEqual({
                'xtream-1': ['movie:501'],
            });
            expect(read(KEYS.recentItems)).toEqual({ 'xtream-1': [] });
            const [restored] = read(KEYS.playbackPositions)['xtream-1'];
            expect(read(KEYS.playbackPositions)['xtream-1']).toHaveLength(1);
            expect(typeof restored.updatedAt).toBe('string');
        });

        it('fails the entry and keeps the restore parked when a write fails', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            const storage = createBrowserBackedStorage();
            storage.setItem.mockImplementation((key: string, value: string) => {
                if (key === KEYS.recentItems) throw new Error('disk full');
                localStorage.setItem(key, value);
            });
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState(storage),
            });

            const summary = await service.importBackup(xtreamOnly(manifest));

            expect(summary.failed).toBe(1);
            expect(summary.errors[0]).toContain('disk full');
            // The Xtream store replays the whole state when the playlist opens.
            expect(
                pendingRestore(service).getOrThrow('xtream-1')
            ).not.toBeNull();
            // That replay carries no titles, so they are merged regardless.
            expect(read(KEYS.collectionItems)).toEqual({
                'xtream-1': { 'movie:501': heat, 'series:77': legacyShow },
            });
        });

        it('replaces a damaged title cache but refuses an unreadable storage', async () => {
            const manifest = await exportSeeded();
            localStorage.setItem(KEYS.collectionItems, '{"xtream-1": {');
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });

            expect(
                (await service.importBackup(xtreamOnly(manifest))).failed
            ).toBe(0);
            expect(read(KEYS.collectionItems)).toEqual({
                'xtream-1': { 'movie:501': heat, 'series:77': legacyShow },
            });

            const denied = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: () => {
                        throw new DOMException('denied', 'SecurityError');
                    },
                    setItem: jest.fn(),
                    removeItem: jest.fn(),
                }),
            });
            const summary = await denied.importBackup(xtreamOnly(manifest));
            expect(summary.failed).toBe(1);
            expect(summary.errors[0]).toContain('denied');
        });

        it('still restores the lists when the snapshots exceed the quota', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            const storage = createBrowserBackedStorage();
            storage.setItem.mockImplementation((key: string, value: string) => {
                if (key === KEYS.collectionItems) {
                    throw new DOMException('full', 'QuotaExceededError');
                }
                localStorage.setItem(key, value);
            });
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState(storage),
            });

            const summary = await service.importBackup(
                JSON.stringify(manifest)
            );

            expect(summary.failed).toBe(0);
            expect(read(KEYS.favorites)['xtream-1']).toEqual([
                'movie:501',
                'series:77',
            ]);
            expect(read(KEYS.collectionItems)).toBeNull();
        });
    });

    describe('near the storage quota', () => {
        const listKeys = [
            KEYS.favorites,
            KEYS.recentItems,
            KEYS.playbackPositions,
        ];

        /** Storage that refuses a write once all values exceed `budget`. */
        function quotaStorage(budget: number) {
            const data = new Map<string, string>();
            const used = () =>
                [...data].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
            const storage: UserDataStorage = {
                getItem: (key) => data.get(key) ?? null,
                setItem: (key, value) => {
                    const previous = data.get(key);
                    data.set(key, value);
                    if (used() <= budget) return;
                    if (previous === undefined) data.delete(key);
                    else data.set(key, previous);
                    throw new DOMException('full', 'QuotaExceededError');
                },
                removeItem: (key) => void data.delete(key),
            };
            return { data, storage };
        }

        async function importInto(budget: number) {
            const manifest = await exportSeeded();
            const quota = quotaStorage(budget);
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState(quota.storage),
            });
            const summary = await service.importBackup(xtreamOnly(manifest));
            return { summary, data: quota.data };
        }

        async function listsSize(): Promise<number> {
            const { data } = await importInto(Infinity);
            return listKeys.reduce(
                (sum, key) => sum + key.length + (data.get(key) ?? '').length,
                0
            );
        }

        it('restores the lists that fit without the optional snapshots', async () => {
            const { summary, data } = await importInto(await listsSize());

            expect(summary.failed).toBe(0);
            expect(JSON.parse(data.get(KEYS.favorites) ?? '{}')).toEqual({
                'xtream-1': ['movie:501', 'series:77'],
            });
            expect(data.has(KEYS.collectionItems)).toBe(false);
        });

        it('leaves the space to the replay when a list does not fit', async () => {
            const { summary, data } = await importInto((await listsSize()) - 1);

            expect(summary.failed).toBe(1);
            // The snapshots would only take room the store's replay needs.
            expect(data.has(KEYS.collectionItems)).toBe(false);
        });
    });

    it('follows the Xtream data source on a desktop bridge without its SQLite API', async () => {
        // A partial or stale preload: XTREAM_DATA_SOURCE falls back to the
        // browser storage, so the backup must read and restore that too.
        (window as unknown as { electron?: unknown }).electron = {};
        const runtime = { supportsXtreamSqliteDataSource: false };
        const manifest = await (async () => {
            seed();
            const exporter = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                runtime,
            });
            return (await exporter.exportBackup()).manifest;
        })();
        expect(xtreamEntry(manifest).userState.favorites).toHaveLength(2);

        localStorage.clear();
        const importer = createPlaylistBackupService({
            playlistsService: playlistsService([existingXtreamPlaylist]),
            runtime,
        });
        const summary = await importer.importBackup(xtreamOnly(manifest));

        expect(summary.failed).toBe(0);
        expect(read(KEYS.favorites)).toEqual({
            'xtream-1': ['movie:501', 'series:77'],
        });
        expect(pendingRestore(importer).getOrThrow('xtream-1')).toBeNull();
    });

    it('reads and writes through USER_DATA_STORAGE, not localStorage', async () => {
        // The self-hosted server mode provides a server-synced storage here.
        const synced = new Map<string, string>();
        const serverStorage: UserDataStorage = {
            getItem: (key) => synced.get(key) ?? null,
            setItem: (key, value) => void synced.set(key, value),
            removeItem: (key) => void synced.delete(key),
        };
        TestBed.configureTestingModule({
            providers: [
                { provide: USER_DATA_STORAGE, useValue: serverStorage },
            ],
        });
        const pwaXtream = TestBed.inject(PwaXtreamBackupStateService);
        seed(serverStorage);
        const exporter = createPlaylistBackupService({
            playlistsService: playlistsService([existingXtreamPlaylist]),
            pwaXtream,
        });

        const { json, manifest } = await exporter.exportBackup();
        expect(xtreamEntry(manifest).userState.favorites).toHaveLength(2);

        synced.clear();
        const importer = createPlaylistBackupService({
            playlistsService: playlistsService([]),
            pwaXtream,
        });
        await importer.importBackup(json);

        expect(read(KEYS.favorites, serverStorage)).toEqual({
            'xtream-1': ['movie:501', 'series:77'],
        });
        expect(localStorage.getItem(KEYS.favorites)).toBeNull();
    });

    function createBrowserBackedStorage() {
        return {
            getItem: (key: string) => localStorage.getItem(key),
            setItem: jest.fn(),
            removeItem: (key: string) => localStorage.removeItem(key),
        };
    }
});
