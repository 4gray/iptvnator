import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    Playlist,
    PlaylistBackupManifestV1,
    XtreamPlaylistBackupEntry,
    XtreamPendingRestoreState,
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
        const parsed = JSON.parse(storage.getItem(key) ?? 'null');
        if (parsed && typeof parsed === 'object')
            delete parsed['__iptvnator_xtream_restore_receipts__'];
        return parsed;
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
        it('exports numeric-string identity from legacy browser snapshots', async () => {
            seed();
            const snapshots = read(KEYS.collectionItems);
            Object.assign(snapshots['xtream-1']['movie:501'], {
                tmdb_id: '949',
                release_year: '1995',
                added_at: '2026-01-02',
                position: 3,
            });
            localStorage.setItem(
                KEYS.collectionItems,
                JSON.stringify(snapshots)
            );
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });
            const manifest = (await service.exportBackup()).manifest;
            expect(xtreamEntry(manifest).userState.favorites[0]).toMatchObject({
                contentType: 'movie',
                xtreamId: 501,
                addedAt: '2026-01-02',
                position: 3,
                snapshot: { title: heat.title, tmdbId: 949, releaseYear: 1995 },
            });
        });

        it('writes each playlist its own favorites, history, positions and snapshots', async () => {
            const manifest = await exportSeeded();

            expect(xtreamEntry(manifest).userState).toEqual({
                hiddenCategories: [],
                favorites: [
                    {
                        contentType: 'movie',
                        xtreamId: 501,
                        snapshot: {
                            title: heat.title,
                            posterUrl: heat.poster_url,
                            backdropUrl: heat.backdrop_url,
                        },
                    },
                    {
                        contentType: 'series',
                        xtreamId: 77,
                        snapshot: { title: legacyShow.title },
                    },
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

        it('waits for server user data before it reads the lists', async () => {
            // Server mode: the maps hold the server's data once it was read.
            const ready = jest.fn(async () => {
                seed();
                return true;
            });
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: (key) => localStorage.getItem(key),
                    setItem: (key, value) => localStorage.setItem(key, value),
                    removeItem: (key) => localStorage.removeItem(key),
                    ready,
                }),
            });

            const { manifest } = await service.exportBackup();

            // A fresh read: another device may have changed them since.
            expect(ready).toHaveBeenCalledWith(true);
            expect(ready).toHaveBeenCalledTimes(1);
            expect(xtreamEntry(manifest).userState.favorites).not.toEqual([]);
        });

        it('refuses to export server user data it could not read', async () => {
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: () => null,
                    setItem: jest.fn(),
                    removeItem: jest.fn(),
                    ready: async () => false,
                }),
            });

            await expect(service.exportBackup()).rejects.toThrow(
                /user data could not be read/
            );
        });
    });

    describe('import', () => {
        it('preserves desktop favorite snapshots offline and includes them in browser re-exports', async () => {
            const manifest = await exportSeeded();
            const entry = xtreamEntry(manifest);
            const favorites = [
                {
                    contentType: 'movie' as const,
                    xtreamId: 501,
                    addedAt: '2026-01-02',
                    position: 3,
                    snapshot: {
                        title: 'Offline desktop movie',
                        posterUrl: 'https://img.example.com/saved.jpg',
                        backdropUrl: 'https://img.example.com/saved-wide.jpg',
                        tmdbId: 949,
                        releaseYear: 1995,
                        originalTitle: 'Original movie title',
                    },
                },
            ];
            entry.userState = {
                hiddenCategories: [],
                favorites,
                recentlyViewed: [],
                playbackPositions: [],
            };
            localStorage.clear();
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
            });
            expect(
                await service.importBackup(xtreamOnly(manifest))
            ).toMatchObject({ merged: 1, failed: 0 });
            expect(
                read(KEYS.collectionItems)?.['xtream-1']?.['movie:501']
            ).toMatchObject({
                id: 501,
                xtream_id: 501,
                type: 'movie',
                title: favorites[0].snapshot.title,
                poster_url: favorites[0].snapshot.posterUrl,
                backdrop_url: favorites[0].snapshot.backdropUrl,
                tmdb_id: 949,
                release_year: 1995,
                original_title: 'Original movie title',
            });
            const { manifest: reexport } = await service.exportBackup();
            expect(xtreamEntry(reexport).userState.favorites).toEqual(
                favorites
            );
            expect(
                xtreamEntry(reexport).userState.collectionItems
            ).toHaveLength(1);
        });

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
                        collectionItem: heat,
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

            const original = xtreamEntry(manifest).userState;
            expect(xtreamEntry(again).userState).toEqual({
                ...original,
                recentlyViewed: original.recentlyViewed.map((item) =>
                    item.contentType === 'movie' && item.xtreamId === 501
                        ? { ...item, collectionItem: heat }
                        : item
                ),
            });
            expect(xtreamEntry(again, 'xtream-2').userState).toEqual(
                xtreamEntry(manifest, 'xtream-2').userState
            );
        });

        it('leaves snapshots alone for an archive without any, and skips damaged ones', async () => {
            const manifest = await exportSeeded();
            const entry = xtreamEntry(manifest);
            entry.userState.favorites = entry.userState.favorites.map(
                ({ contentType, xtreamId }) => ({ contentType, xtreamId })
            );
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
            // Cache-only rows are not carried by pending state, so preserve them here too.
            expect(read(KEYS.collectionItems)).toEqual({
                'xtream-1': { 'movie:501': heat, 'series:77': legacyShow },
            });
        });

        it('keeps the restore parked until server user data was read', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            localStorage.setItem(
                KEYS.favorites,
                JSON.stringify({ 'xtream-1': ['live:1'] })
            );
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: (key) => localStorage.getItem(key),
                    setItem: (key, value) => localStorage.setItem(key, value),
                    removeItem: (key) => localStorage.removeItem(key),
                    ready: async () => false,
                }),
            });

            const summary = await service.importBackup(xtreamOnly(manifest));

            expect(summary.failed).toBe(1);
            // Nothing merged into lists the server may still replace.
            expect(read(KEYS.favorites)).toEqual({ 'xtream-1': ['live:1'] });
            expect(
                pendingRestore(service).getOrThrow('xtream-1')
            ).not.toBeNull();
        });

        it('keeps the restore parked when a conflict merged other lists in', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            // Taken, but merged with an edit another device made meanwhile.
            const flushed = jest
                .fn()
                .mockResolvedValueOnce(true)
                .mockImplementation(async () => {
                    const map = JSON.parse(
                        localStorage.getItem(KEYS.favorites) ?? '{}'
                    );
                    map['xtream-1'] = [...map['xtream-1'], 'live:9'];
                    localStorage.setItem(KEYS.favorites, JSON.stringify(map));
                    return true;
                });
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: (key) => localStorage.getItem(key),
                    setItem: (key, value) => localStorage.setItem(key, value),
                    removeItem: (key) => localStorage.removeItem(key),
                    ready: async () => true,
                    flushed,
                }),
            });

            const summary = await service.importBackup(xtreamOnly(manifest));

            expect(summary.failed).toBe(1);
            expect(summary.errors[0]).toContain('changed elsewhere');
            expect(
                pendingRestore(service).getOrThrow('xtream-1')
            ).not.toBeNull();
        });

        it('replaces nothing while earlier changes to the playlist are unsent', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            localStorage.setItem(
                KEYS.favorites,
                JSON.stringify({ 'xtream-1': ['live:1'] })
            );
            // A write of this page for the playlist that the server refused.
            const flushed = jest.fn().mockResolvedValueOnce(false);
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: (key) => localStorage.getItem(key),
                    setItem: (key, value) => localStorage.setItem(key, value),
                    removeItem: (key) => localStorage.removeItem(key),
                    ready: async () => true,
                    flushed,
                }),
            });

            const summary = await service.importBackup(xtreamOnly(manifest));

            expect(summary.failed).toBe(1);
            // Its edits would have joined the replacement lists.
            expect(read(KEYS.favorites)).toEqual({ 'xtream-1': ['live:1'] });
            expect(
                pendingRestore(service).getOrThrow('xtream-1')
            ).not.toBeNull();
        });

        it('keeps the restore parked until the server took the lists', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            // Nothing unsent before; the restored lists are refused.
            const flushed = jest
                .fn()
                .mockResolvedValueOnce(true)
                .mockResolvedValue(false);
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState({
                    getItem: (key) => localStorage.getItem(key),
                    setItem: (key, value) => localStorage.setItem(key, value),
                    removeItem: (key) => localStorage.removeItem(key),
                    ready: async () => true,
                    flushed,
                }),
            });

            const summary = await service.importBackup(xtreamOnly(manifest));

            expect(flushed).toHaveBeenCalledWith('xtream-1');
            expect(summary.failed).toBe(1);
            expect(
                pendingRestore(service).getOrThrow('xtream-1')
            ).not.toBeNull();
            // Titles are merged regardless: the replay carries none.
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

        it('keeps durable favorite snapshots parked when their write exceeds the quota', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            const storage = createBrowserBackedStorage();
            storage.setItem.mockImplementation((key: string, value: string) => {
                if (key === KEYS.collectionItems)
                    throw new DOMException('full', 'QuotaExceededError');
                localStorage.setItem(key, value);
            });
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState(storage),
            });
            const summary = await service.importBackup(xtreamOnly(manifest));
            expect(summary.failed).toBe(1);
            expect(
                pendingRestore(service).getOrThrow('xtream-1')
            ).toMatchObject({
                favorites: xtreamEntry(manifest).userState.favorites,
            });
            const { manifest: reexport } = await service.exportBackup();
            expect(xtreamEntry(reexport).userState.favorites).toEqual(
                xtreamEntry(manifest).userState.favorites
            );
        });

        it('keeps explicit removals when a required snapshot write is retried', async () => {
            const manifest = await exportSeeded();
            localStorage.clear();
            const storage = createBrowserBackedStorage();
            let full = true;
            storage.setItem.mockImplementation((key: string, value: string) => {
                if (full && key === KEYS.collectionItems)
                    throw new DOMException('full', 'QuotaExceededError');
                localStorage.setItem(key, value);
            });
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState(storage),
            });
            expect(
                (await service.importBackup(xtreamOnly(manifest))).failed
            ).toBe(1);
            // The application has already exposed these successfully written lists.
            const favorites = JSON.parse(
                storage.getItem(KEYS.favorites) ?? '{}'
            );
            favorites['xtream-1'] = [];
            storage.setItem(KEYS.favorites, JSON.stringify(favorites));
            const { manifest: duringRetry } = await service.exportBackup();
            expect(xtreamEntry(duringRetry).userState.favorites).toEqual([]);
            const parked = pendingRestore(service).getOrThrow(
                'xtream-1'
            ) as XtreamPendingRestoreState;
            full = false;
            await createPwaXtreamBackupState(storage).restore(
                'xtream-1',
                parked
            );
            expect(read(KEYS.favorites)['xtream-1']).toEqual([]);
        });

        it('parks old browser availability evidence before a snapshot quota failure', async () => {
            const manifest = await exportSeeded();
            const entry = xtreamEntry(manifest);
            const item = entry.userState.collectionItems?.find(
                (item) => item.xtream_id === 501
            );
            if (!item) throw new Error('Missing browser snapshot fixture');
            Object.assign(item, {
                catalog_status: 'missing',
                catalog_missing_reason: 'identity_conflict',
            });
            localStorage.clear();
            const storage = createBrowserBackedStorage();
            storage.setItem.mockImplementation((key: string, value: string) => {
                if (key === KEYS.collectionItems)
                    throw new DOMException('full', 'QuotaExceededError');
                localStorage.setItem(key, value);
            });
            const service = createPlaylistBackupService({
                playlistsService: playlistsService([existingXtreamPlaylist]),
                pwaXtream: createPwaXtreamBackupState(storage),
            });
            expect(
                (await service.importBackup(xtreamOnly(manifest))).failed
            ).toBe(1);
            const parked = pendingRestore(service).getOrThrow(
                'xtream-1'
            ) as XtreamPendingRestoreState;
            expect(
                parked.favorites.find((item) => item.xtreamId === 501)?.snapshot
            ).toMatchObject({
                title: heat.title,
                catalogStatus: 'missing',
                catalogMissingReason: 'identity_conflict',
            });
            const { manifest: exported } = await service.exportBackup();
            expect(
                xtreamEntry(exported).userState.favorites.find(
                    (item) => item.xtreamId === 501
                )?.snapshot
            ).toMatchObject({
                catalogStatus: 'missing',
                catalogMissingReason: 'identity_conflict',
            });
        });

        it('still restores legacy lists when their optional cache exceeds the quota', async () => {
            const manifest = await exportSeeded();
            // Old browser archives carry only optional collectionItems, not durable snapshots.
            for (const entry of manifest.playlists) {
                if (entry.portalType === 'xtream')
                    entry.userState.favorites = entry.userState.favorites.map(
                        ({ contentType, xtreamId }) => ({
                            contentType,
                            xtreamId,
                        })
                    );
            }
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
            const entry = xtreamEntry(manifest);
            entry.userState.favorites = entry.userState.favorites.map(
                ({ contentType, xtreamId }) => ({ contentType, xtreamId })
            );
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
            expect(
                read(KEYS.favorites, {
                    ...localStorage,
                    getItem: (key: string) => data.get(key) ?? null,
                })
            ).toEqual({
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
