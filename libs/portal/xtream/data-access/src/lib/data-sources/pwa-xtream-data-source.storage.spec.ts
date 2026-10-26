import { TestBed } from '@angular/core/testing';
import {
    ParentalLockService,
    PlaylistsService,
    USER_DATA_STORAGE,
} from '@iptvnator/services';
import { of } from 'rxjs';
import { XtreamApiService } from '../services/xtream-api.service';
import { PwaXtreamDataSource } from './pwa-xtream-data-source';

describe('PwaXtreamDataSource injected user data storage', () => {
    let apiService: {
        getStreams: jest.Mock;
    };
    let playlistsService: {
        getPlaylistById: jest.Mock;
        transformPlaylistMeta: jest.Mock;
    };
    let parentalLock: {
        active: jest.Mock<boolean, []>;
        lockedXtreamIds: jest.Mock<number[], [string, string]>;
        withholdsEverything: jest.Mock<boolean, []>;
    };

    beforeEach(() => {
        localStorage.clear();
        apiService = {
            getStreams: jest.fn(),
        };
        playlistsService = {
            getPlaylistById: jest.fn(() => of(undefined)),
            transformPlaylistMeta: jest.fn(() => of(null)),
        };
        parentalLock = {
            active: jest.fn(() => false),
            lockedXtreamIds: jest.fn(
                (_playlistId: string, _type: string): number[] => []
            ),
            withholdsEverything: jest.fn(() => false),
        };
    });
    afterEach(() => localStorage.clear());
    it('reads and writes favorites through it, not localStorage', async () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
            removeItem: (key: string) => {
                values.delete(key);
            },
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: USER_DATA_STORAGE, useValue: storage },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: XtreamApiService, useValue: apiService },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });
        const source = TestBed.inject(PwaXtreamDataSource);

        values.set('xtream-favorites', JSON.stringify({ p1: ['live:1'] }));
        await source.deletePlaylist('p1');

        expect(JSON.parse(values.get('xtream-favorites') ?? '{}')).toEqual({});
        expect(localStorage.getItem('xtream-favorites')).toBeNull();
    });

    it('reads positions once the first server read settled', async () => {
        const values = new Map<string, string>();
        let firstRead = (): void => undefined;
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
            removeItem: (key: string) => {
                values.delete(key);
            },
            // Server mode: the server's data lands in the cache later.
            ready: () =>
                new Promise<boolean>((resolve) => {
                    firstRead = () => {
                        values.set(
                            'xtream-playback-positions',
                            JSON.stringify({
                                p1: [
                                    {
                                        contentXtreamId: 501,
                                        contentType: 'vod',
                                        positionSeconds: 120,
                                    },
                                ],
                            })
                        );
                        resolve(true);
                    };
                }),
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: USER_DATA_STORAGE, useValue: storage },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: XtreamApiService, useValue: apiService },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });
        const source = TestBed.inject(PwaXtreamDataSource);

        const position = source.getPlaybackPosition('p1', 501, 'vod');
        // The read is still running while other work goes on.
        for (let turn = 0; turn < 5; turn += 1) {
            await Promise.resolve();
        }
        firstRead();

        await expect(position).resolves.toMatchObject({
            positionSeconds: 120,
        });
    });

    it('keeps a restore parked while the server user data is unread', async () => {
        const values = new Map<string, string>([
            ['xtream-favorites', JSON.stringify({ p1: ['live:1'] })],
        ]);
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
            removeItem: (key: string) => {
                values.delete(key);
            },
            ready: jest.fn(async () => false),
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: USER_DATA_STORAGE, useValue: storage },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: XtreamApiService, useValue: apiService },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });
        const source = TestBed.inject(PwaXtreamDataSource);

        await expect(
            source.restoreUserData('p1', {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            } as never)
        ).rejects.toThrow(/restore waits/);
        // A fresh read: the restore replaces the current lists.
        expect(storage.ready).toHaveBeenCalledWith(true);
        expect(values.get('xtream-favorites')).toBe(
            JSON.stringify({ p1: ['live:1'] })
        );
    });

    it('keeps a restore parked while the server refuses its lists', async () => {
        const values = new Map<string, string>();
        // Nothing unsent before; the restored lists are refused.
        const flushed = jest
            .fn()
            .mockResolvedValueOnce(true)
            .mockResolvedValue(false);
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
            removeItem: (key: string) => {
                values.delete(key);
            },
            ready: async () => true,
            flushed,
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: USER_DATA_STORAGE, useValue: storage },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: XtreamApiService, useValue: apiService },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });
        const source = TestBed.inject(PwaXtreamDataSource);

        await expect(
            source.restoreUserData('p1', {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            } as never)
        ).rejects.toThrow(/did not take the restored lists/);
        expect(flushed).toHaveBeenCalledWith('p1');
    });

    it('replaces the lists, and runs again when a conflict merged them', async () => {
        const values = new Map<string, string>([
            ['xtream-favorites', JSON.stringify({ p1: ['live:1'] })],
        ]);
        let merge = false;
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
            removeItem: (key: string) => {
                values.delete(key);
            },
            ready: async () => true,
            flushed: jest.fn(async () => {
                if (merge) {
                    // Another device added one meanwhile: replayed in.
                    values.set(
                        'xtream-favorites',
                        JSON.stringify({ p1: ['live:9', 'movie:5'] })
                    );
                }
                return true;
            }),
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: USER_DATA_STORAGE, useValue: storage },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: XtreamApiService, useValue: apiService },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });
        const source = TestBed.inject(PwaXtreamDataSource);
        const state = {
            hiddenCategories: [],
            favorites: [{ xtreamId: 5, contentType: 'movie' }],
            recentlyViewed: [],
            playbackPositions: [],
        } as never;

        await source.restoreUserData('p1', state);
        expect(JSON.parse(values.get('xtream-favorites') ?? '{}').p1).toEqual([
            'movie:5',
        ]);
        // A saved restore may list one favorite twice: reads drop the
        // copy on both sides of the comparison.
        await expect(
            source.restoreUserData('p1', {
                ...(state as object),
                favorites: [
                    { xtreamId: 5, contentType: 'movie' },
                    { xtreamId: 5, contentType: 'movie' },
                ],
            } as never)
        ).resolves.toBeUndefined();

        merge = true;
        // A new import gets a new receipt; completed replays intentionally preserve later edits.
        await expect(
            source.restoreUserData('p1', {
                ...(state as object),
                favoritesRestoreId: 'new-conflicting-import',
            } as never)
        ).rejects.toThrow(/changed elsewhere/);
    });

    it('replaces nothing while earlier changes to the playlist are unsent', async () => {
        const values = new Map<string, string>([
            ['xtream-favorites', JSON.stringify({ p1: ['live:1'] })],
        ]);
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
            removeItem: (key: string) => {
                values.delete(key);
            },
            ready: async () => true,
            flushed: jest.fn().mockResolvedValueOnce(false),
        };
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                PwaXtreamDataSource,
                { provide: USER_DATA_STORAGE, useValue: storage },
                { provide: ParentalLockService, useValue: parentalLock },
                { provide: XtreamApiService, useValue: apiService },
                { provide: PlaylistsService, useValue: playlistsService },
            ],
        });
        const source = TestBed.inject(PwaXtreamDataSource);

        await expect(
            source.restoreUserData('p1', {
                hiddenCategories: [],
                favorites: [],
                recentlyViewed: [],
                playbackPositions: [],
            } as never)
        ).rejects.toThrow(/not on the server yet/);
        expect(values.get('xtream-favorites')).toBe(
            JSON.stringify({ p1: ['live:1'] })
        );
    });
});
