import { getXtreamPendingRestoreStorageKey } from '@iptvnator/shared/interfaces';
import { XtreamPendingRestoreService } from './xtream-pending-restore.service';
import { prepareSourceConnection } from './source-sync/source-connection';
import { materializePendingXtreamFavorites } from './xtream-pending-favorites';
import { sourceProfileStorageKey } from './source-sync/source-profile-storage';

describe('legacy pending restores in a source-server profile', () => {
    const key = getXtreamPendingRestoreStorageKey('old-source');
    const state = {
        hiddenCategories: [],
        favorites: [{ xtreamId: 42, contentType: 'movie' }],
        recentlyViewed: [],
        playbackPositions: [],
    };
    const originalElectron = window.electron;
    beforeEach(async () => {
        Reflect.deleteProperty(window, 'electron');
        localStorage.clear();
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({
                apiUrl: 'https://nas.test/api',
                instanceId: 'nas',
            })
        );
        await prepareSourceConnection();
        localStorage.setItem(key, JSON.stringify(state));
    });
    afterEach(() => {
        window.electron = originalElectron;
        jest.restoreAllMocks();
        localStorage.clear();
    });

    it('adopts a verified legacy snapshot and does not resurrect it after consumption', async () => {
        localStorage.setItem('iptvnator-server:cache-owner', 'nas');
        const service = new XtreamPendingRestoreService();
        const snapshot = service.getSnapshotOrThrow('old-source');
        expect(snapshot?.state).toMatchObject(state);
        expect(localStorage.getItem(sourceProfileStorageKey(key))).toBe(
            JSON.stringify(state)
        );
        expect(localStorage.getItem(key)).toBe(JSON.stringify(state));
        expect(service.clear('old-source', snapshot!.state)).toBe(true);
        expect(
            new XtreamPendingRestoreService().getOrThrow('old-source')
        ).toBeNull();
    });
    it('does not copy another server or the standalone profile without legacy evidence', () => {
        localStorage.setItem('iptvnator-server:cache-owner', 'another-nas');
        expect(
            new XtreamPendingRestoreService().getOrThrow('old-source')
        ).toBeNull();
        expect(localStorage.getItem(key)).toBe(JSON.stringify(state));
    });
    it.each(['', JSON.stringify({ ...state, favorites: [] })])(
        'preserves a newer profile value or tombstone: %s',
        (value) => {
            localStorage.setItem('iptvnator-server:cache-owner', 'nas');
            localStorage.setItem(sourceProfileStorageKey(key), value);
            const restored = new XtreamPendingRestoreService().getOrThrow(
                'old-source'
            );
            expect(restored?.favorites ?? []).toEqual([]);
            expect(localStorage.getItem(sourceProfileStorageKey(key))).toBe(
                value
            );
        }
    );
    it('keeps native-profile restores isolated from the original desktop archive', () => {
        localStorage.setItem('iptvnator-server:cache-owner', 'nas');
        window.electron = {
            sourceSyncConnection: () => ({
                apiUrl: 'https://nas.test/api',
                instanceId: 'nas',
            }),
        } as unknown as typeof window.electron;
        expect(
            new XtreamPendingRestoreService().getOrThrow('old-source')
        ).toBeNull();
        expect(localStorage.getItem(key)).toBe(JSON.stringify(state));
    });
    it.each([undefined, 'old-source'])(
        'keeps native pending-favorites conversion out of standalone archives (filter %s)',
        async (id) => {
            window.electron = {
                sourceSyncConnection: () => ({
                    apiUrl: 'https://nas.test/api',
                    instanceId: 'nas',
                }),
            } as unknown as typeof window.electron;
            const bridge = {
                dbGetPlaylist: jest
                    .fn()
                    .mockResolvedValue({ id: 'old-source', type: 'xtream' }),
                dbRestoreXtreamFavorites: jest
                    .fn()
                    .mockResolvedValue({ success: true }),
                dbReplaceAllPlaybackPositions: jest.fn(),
            };
            await materializePendingXtreamFavorites(bridge, id);
            expect(bridge.dbRestoreXtreamFavorites).not.toHaveBeenCalled();
            expect(localStorage.getItem(key)).toBe(JSON.stringify(state));
        }
    );
    it.each([undefined, 'old-source'])(
        'converts only the selected profile archive (filter %s)',
        async (id) => {
            window.electron = {
                sourceSyncConnection: () => ({
                    apiUrl: 'https://nas.test/api',
                    instanceId: 'nas',
                }),
            } as unknown as typeof window.electron;
            const profile = {
                ...state,
                favorites: [{ xtreamId: 84, contentType: 'movie' }],
                favoritesRestoreId: 'profile-archive',
            };
            localStorage.setItem(
                sourceProfileStorageKey(key),
                JSON.stringify(profile)
            );
            localStorage.setItem(
                `iptvnator-server:other:${key}`,
                JSON.stringify({
                    ...state,
                    favorites: [{ xtreamId: 999, contentType: 'movie' }],
                })
            );
            const bridge = {
                dbGetPlaylist: jest
                    .fn()
                    .mockResolvedValue({ id: 'old-source', type: 'xtream' }),
                dbRestoreXtreamFavorites: jest
                    .fn()
                    .mockResolvedValue({ success: true }),
                dbReplaceAllPlaybackPositions: jest.fn(),
            };
            await materializePendingXtreamFavorites(bridge, id);
            expect(bridge.dbRestoreXtreamFavorites).toHaveBeenCalledTimes(1);
            expect(bridge.dbRestoreXtreamFavorites).toHaveBeenCalledWith(
                'old-source',
                profile.favorites,
                'profile-archive'
            );
            expect(localStorage.getItem(key)).toBe(JSON.stringify(state));
        }
    );
    it.each(['snapshot', 'receipt'])(
        'rejects a migration when writing its %s silently does nothing',
        (part) => {
            localStorage.setItem('iptvnator-server:cache-owner', 'nas');
            const target = sourceProfileStorageKey(key);
            const failing =
                part === 'snapshot' ? target : `${target}:legacy-migrated`;
            const write = Storage.prototype.setItem;
            const blocked = jest
                .spyOn(Storage.prototype, 'setItem')
                .mockImplementation(function (this: Storage, name, value) {
                    if (name !== failing) write.call(this, name, value);
                });
            const service = new XtreamPendingRestoreService();
            expect(() => service.getOrThrow('old-source')).toThrow(
                'not persisted'
            );
            blocked.mockRestore();
            expect(service.getOrThrow('old-source')).toMatchObject(state);
        }
    );
    it('fails strict reads until a failed migration copy can be retried', () => {
        localStorage.setItem('iptvnator-server:cache-owner', 'nas');
        const write = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('quota');
            });
        const service = new XtreamPendingRestoreService();
        expect(() => service.getOrThrow('old-source')).toThrow('quota');
        write.mockRestore();
        expect(service.getOrThrow('old-source')).toMatchObject(state);
    });
});
