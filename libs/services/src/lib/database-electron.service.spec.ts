import { DatabaseService } from './database-electron.service';
import { materializePendingXtreamFavorites } from './xtream-pending-favorites';

describe('DatabaseService browser guards', () => {
    const originalElectron = window.electron;
    let service: DatabaseService;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        localStorage.clear();
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
        jest.restoreAllMocks();
        localStorage.clear();
        consoleErrorSpy.mockRestore();
        Object.defineProperty(window, 'electron', {
            configurable: true,
            writable: true,
            value: originalElectron,
        });
    });

    it('does not report success when the favorites worker rejects a conflicting identity', async () => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: {
                dbAddFavorite: jest.fn().mockResolvedValue({
                    success: false,
                    error: 'XTREAM_FAVORITE_IDENTITY_CONFLICT',
                }),
            },
        });
        await expect(service.addToFavorites(42, 'playlist-1')).resolves.toBe(
            false
        );
        await expect(
            service.addToFavoritesOrThrow(42, 'playlist-1')
        ).rejects.toThrow('XTREAM_FAVORITE_IDENTITY_CONFLICT');
    });

    it('recovers legacy favorites on collection reads without a portal status or catalog request', async () => {
        const pending = {
            favorites: [{ contentType: 'movie', xtreamId: 7 }],
            hiddenCategories: [],
            recentlyViewed: [],
            playbackPositions: [],
        };
        localStorage.setItem(
            'xtream-restore-playlist-1',
            JSON.stringify(pending)
        );
        const bridge = {
            dbReplaceAllPlaybackPositions: jest.fn(),
            dbGetPlaylist: jest.fn().mockResolvedValue({ type: 'xtream' }),
            dbRestoreXtreamFavorites: jest
                .fn()
                .mockResolvedValue({ success: true }),
            dbGetFavorites: jest.fn().mockResolvedValue([]),
            dbGetAllGlobalFavorites: jest.fn().mockResolvedValue([]),
        };
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: bridge,
        });
        await service.getFavorites('playlist-1');
        expect(bridge.dbRestoreXtreamFavorites).toHaveBeenCalledWith(
            'playlist-1',
            pending.favorites,
            undefined
        );
        expect(
            bridge.dbRestoreXtreamFavorites.mock.invocationCallOrder[0]
        ).toBeLessThan(bridge.dbGetFavorites.mock.invocationCallOrder[0]);
        await service.getAllGlobalFavorites();
        expect(bridge.dbRestoreXtreamFavorites).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem('xtream-restore-playlist-1')).toBe(
            JSON.stringify(pending)
        );
    });

    it.each([
        'getGlobalFavorites',
        'getAllGlobalFavorites',
        'getFavorites',
    ] as const)(
        '%s still reads healthy favorites when a pending conversion fails',
        async (method) => {
            const pending = JSON.stringify({
                favorites: [{ contentType: 'movie', xtreamId: 7.5 }],
            });
            localStorage.setItem('xtream-restore-broken', pending);
            localStorage.setItem(
                'xtream-restore-healthy',
                JSON.stringify({
                    favorites: [{ contentType: 'movie', xtreamId: 9 }],
                })
            );
            const rows = [{ favorite_id: 1, title: 'Saved favorite' }];
            const read = jest.fn().mockResolvedValue(rows);
            const restore = jest.fn(async (id: string) => {
                if (id === 'broken')
                    throw new Error('Invalid favorite identity');
                return { success: true };
            });
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: {
                    dbReplaceAllPlaybackPositions: jest.fn(),
                    dbGetPlaylist: jest
                        .fn()
                        .mockResolvedValue({ type: 'xtream' }),
                    dbRestoreXtreamFavorites: restore,
                    dbGetGlobalFavorites: read,
                    dbGetAllGlobalFavorites: read,
                    dbGetFavorites: read,
                    dbGetFavoritesForBackup: jest.fn(),
                },
            });
            await expect(service[method]('broken')).resolves.toEqual(rows);
            expect(read).toHaveBeenCalledTimes(1);
            if (method !== 'getFavorites') {
                expect(restore).toHaveBeenCalledWith(
                    'healthy',
                    [{ contentType: 'movie', xtreamId: 9 }],
                    undefined
                );
            }
            expect(localStorage.getItem('xtream-restore-broken')).toBe(pending);
            restore.mockResolvedValueOnce({ success: false });
            await expect(service.getFavorites('broken')).resolves.toEqual(rows);
            await expect(service.getFavoritesOrThrow('broken')).rejects.toThrow(
                'Invalid favorite identity'
            );
            expect(
                window.electron.dbGetFavoritesForBackup
            ).not.toHaveBeenCalled();
        }
    );

    it.each(['storage', 'length', 'key', 'getItem'] as const)(
        'reads SQLite despite a failing localStorage %s, but rejects strict conversion',
        async (failure) => {
            localStorage.setItem(
                'xtream-restore-broken',
                JSON.stringify({
                    favorites: [{ contentType: 'movie', xtreamId: 7 }],
                })
            );
            localStorage.setItem(
                'xtream-restore-healthy',
                JSON.stringify({
                    favorites: [{ contentType: 'movie', xtreamId: 9 }],
                })
            );
            const rows = [{ favorite_id: 1, title: 'Saved favorite' }];
            const read = jest.fn().mockResolvedValue(rows);
            const bridge = {
                dbReplaceAllPlaybackPositions: jest.fn(),
                dbGetPlaylist: jest.fn().mockResolvedValue({ type: 'xtream' }),
                dbRestoreXtreamFavorites: jest
                    .fn()
                    .mockResolvedValue({ success: true }),
                dbGetFavorites: read,
                dbGetGlobalFavorites: read,
                dbGetAllGlobalFavorites: read,
                dbGetFavoritesForBackup: jest.fn(),
            };
            Object.defineProperty(window, 'electron', {
                configurable: true,
                value: bridge,
            });
            const unavailable = () => {
                throw new Error('Storage unavailable');
            };
            if (failure === 'storage') {
                jest.spyOn(window, 'localStorage', 'get').mockImplementation(
                    unavailable
                );
            } else if (failure === 'length') {
                jest.spyOn(
                    Storage.prototype,
                    'length',
                    'get'
                ).mockImplementation(unavailable);
            } else if (failure === 'key') {
                jest.spyOn(Storage.prototype, 'key').mockImplementation(
                    unavailable
                );
            } else {
                const getItem = Storage.prototype.getItem;
                jest.spyOn(Storage.prototype, 'getItem').mockImplementation(
                    function (this: Storage, key) {
                        if (key === 'xtream-restore-broken')
                            return unavailable();
                        return getItem.call(this, key);
                    }
                );
            }
            for (const method of [
                'getGlobalFavorites',
                'getAllGlobalFavorites',
                'getFavorites',
            ] as const) {
                await expect(service[method]('broken')).resolves.toEqual(rows);
            }
            expect(read).toHaveBeenCalledTimes(3);
            if (failure === 'getItem') {
                expect(bridge.dbRestoreXtreamFavorites).toHaveBeenCalledWith(
                    'healthy',
                    [{ contentType: 'movie', xtreamId: 9 }],
                    undefined
                );
            }
            await expect(
                materializePendingXtreamFavorites(bridge)
            ).rejects.toThrow('Storage unavailable');
            if (failure === 'storage' || failure === 'getItem') {
                await expect(
                    service.getFavoritesOrThrow('broken')
                ).rejects.toThrow('Storage unavailable');
                expect(bridge.dbGetFavoritesForBackup).not.toHaveBeenCalled();
            }
        }
    );

    it('does not replay a parked backup through collection, export or direct snapshot reads until restore is supported', async () => {
        const favorites = [{ contentType: 'movie' as const, xtreamId: 7 }];
        const pending = JSON.stringify({
            favorites,
            favoritesRestoreId: 'parked-backup',
        });
        localStorage.setItem('xtream-restore-playlist-1', pending);
        const rows = [{ favorite_id: 1, title: 'Previously saved favorite' }];
        const bridge = {
            dbGetPlaylist: jest.fn().mockResolvedValue({ type: 'xtream' }),
            dbRestoreXtreamFavorites: jest
                .fn()
                .mockResolvedValue({ success: true }),
            dbGetFavorites: jest.fn().mockResolvedValue(rows),
            dbGetGlobalFavorites: jest.fn().mockResolvedValue(rows),
            dbGetAllGlobalFavorites: jest.fn().mockResolvedValue(rows),
            dbGetFavoritesForBackup: jest.fn().mockResolvedValue(rows),
            dbReplaceAllPlaybackPositions: undefined as jest.Mock | undefined,
        };
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: bridge,
        });
        for (const method of [
            'getFavorites',
            'getGlobalFavorites',
            'getAllGlobalFavorites',
        ] as const) {
            await expect(service[method]('playlist-1')).resolves.toEqual(rows);
        }
        expect(bridge.dbRestoreXtreamFavorites).not.toHaveBeenCalled();
        await expect(service.getFavoritesOrThrow('playlist-1')).rejects.toThrow(
            'replacement method is unavailable'
        );
        await expect(
            service.restoreXtreamFavoriteSnapshots(
                'playlist-1',
                favorites,
                'parked-backup'
            )
        ).rejects.toThrow('replacement method is unavailable');
        expect(bridge.dbRestoreXtreamFavorites).not.toHaveBeenCalled();
        expect(bridge.dbGetFavoritesForBackup).not.toHaveBeenCalled();
        expect(localStorage.getItem('xtream-restore-playlist-1')).toBe(pending);
        bridge.dbReplaceAllPlaybackPositions = jest.fn();
        await expect(
            service.getFavoritesOrThrow('playlist-1')
        ).resolves.toEqual(rows);
        expect(bridge.dbRestoreXtreamFavorites).toHaveBeenCalledWith(
            'playlist-1',
            favorites,
            'parked-backup'
        );
        expect(bridge.dbReplaceAllPlaybackPositions).not.toHaveBeenCalled();
    });

    it('ignores orphan legacy state but never treats failed conversion as an empty backup', async () => {
        localStorage.setItem(
            'xtream-restore-orphan',
            JSON.stringify({
                favorites: [{ contentType: 'movie', xtreamId: 7 }],
            })
        );
        const bridge = {
            dbReplaceAllPlaybackPositions: jest.fn(),
            dbGetPlaylist: jest.fn().mockResolvedValue(null),
            dbRestoreXtreamFavorites: jest
                .fn()
                .mockRejectedValue(new Error('SQLite unavailable')),
            dbGetFavoritesForBackup: jest.fn().mockResolvedValue([]),
        };
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: bridge,
        });
        await expect(service.getFavoritesOrThrow('orphan')).resolves.toEqual(
            []
        );
        expect(bridge.dbRestoreXtreamFavorites).not.toHaveBeenCalled();
        bridge.dbGetPlaylist.mockResolvedValue({ type: 'xtream' });
        await expect(service.getFavoritesOrThrow('orphan')).rejects.toThrow(
            'SQLite unavailable'
        );
        expect(bridge.dbGetFavoritesForBackup).toHaveBeenCalledTimes(1);
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
        await expect(service.getGlobalRecentlyViewed()).resolves.toEqual([]);
        await expect(service.getGlobalFavorites()).resolves.toEqual([]);
        await expect(service.getAllGlobalFavorites()).resolves.toEqual([]);
        await expect(
            service.clearGlobalRecentlyViewed()
        ).resolves.toBeUndefined();
        await expect(service.addToFavorites(20229, 'playlist-1')).resolves.toBe(
            false
        );
        await expect(
            service.removeFromFavorites(20229, 'playlist-1')
        ).resolves.toBe(false);
        await expect(service.isFavorite(20229, 'playlist-1')).resolves.toBe(
            false
        );
        await expect(service.getFavorites('playlist-1')).resolves.toEqual([]);
        await expect(service.getRecentItems('playlist-1')).resolves.toEqual([]);
        await expect(service.addRecentItem(20229, 'playlist-1')).resolves.toBe(
            false
        );
        await expect(
            service.clearPlaylistRecentItems('playlist-1')
        ).resolves.toBe(false);
        await expect(
            service.removeRecentItem(20229, 'playlist-1')
        ).resolves.toBe(false);
        await expect(
            service.removeRecentItemsBatch([
                { contentId: 20229, playlistId: 'playlist-1' },
            ])
        ).resolves.toBe(false);

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
