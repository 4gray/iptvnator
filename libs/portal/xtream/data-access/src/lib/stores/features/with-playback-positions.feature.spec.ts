import { TestBed } from '@angular/core/testing';
import { signalStore } from '@ngrx/signals';
import { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import { XTREAM_DATA_SOURCE } from '../../data-sources/xtream-data-source.interface';
import { withPlaybackPositions } from './with-playback-positions.feature';

function position(
    contentXtreamId: number,
    playlistId: string
): PlaybackPositionData {
    return {
        contentXtreamId,
        contentType: 'episode',
        seriesXtreamId: 7,
        seasonNumber: 1,
        episodeNumber: 1,
        positionSeconds: 50,
        durationSeconds: 100,
        playlistId,
    };
}

describe('withPlaybackPositions', () => {
    const TestStore = signalStore(
        { providedIn: 'root' },
        withPlaybackPositions()
    );
    const getAllPlaybackPositions = jest.fn();
    const savePlaybackPosition = jest.fn();
    const getPlaybackPosition = jest.fn();
    const getSeriesPlaybackPositions = jest.fn();
    let playbackUpdate!: (data: PlaybackPositionData) => void;

    const requestWaiters = new Map<
        jest.Mock,
        { count: number; resolve: () => void }[]
    >();
    function requestStarted(mock: jest.Mock, count = 1): Promise<void> {
        if (mock.mock.calls.length >= count) return Promise.resolve();
        return new Promise((resolve) => {
            const waiters = requestWaiters.get(mock) ?? [];
            waiters.push({ count, resolve });
            requestWaiters.set(mock, waiters);
        });
    }
    const trackRequest =
        (mock: jest.Mock) =>
        (...args: unknown[]) => {
            const result: unknown = mock(...args);
            for (const waiter of requestWaiters.get(mock) ?? []) {
                if (mock.mock.calls.length >= waiter.count) waiter.resolve();
            }
            return result;
        };

    function createStore() {
        TestBed.configureTestingModule({
            providers: [
                {
                    provide: XTREAM_DATA_SOURCE,
                    useValue: {
                        getAllPlaybackPositions: trackRequest(
                            getAllPlaybackPositions
                        ),
                        savePlaybackPosition:
                            trackRequest(savePlaybackPosition),
                        getPlaybackPosition: trackRequest(getPlaybackPosition),
                        getSeriesPlaybackPositions: trackRequest(
                            getSeriesPlaybackPositions
                        ),
                    },
                },
                {
                    provide: PlaybackPositionRuntimeBridgeService,
                    useValue: {
                        onPlaybackPositionUpdate: jest.fn(
                            (
                                callback: (data: PlaybackPositionData) => void
                            ) => {
                                playbackUpdate = callback;
                                return jest.fn();
                            }
                        ),
                    },
                },
            ],
        });
        return TestBed.inject(TestStore);
    }

    beforeEach(() => {
        requestWaiters.clear();
        getAllPlaybackPositions.mockReset();
        savePlaybackPosition.mockReset().mockResolvedValue(undefined);
        getPlaybackPosition.mockReset();
        getSeriesPlaybackPositions.mockReset();
    });

    it.each(['b', null] as const)(
        'persists external progress for A when the catalog owner is %s',
        async (owner) => {
            const store = createStore();
            if (owner) {
                getAllPlaybackPositions.mockResolvedValueOnce([
                    position(11, owner),
                ]);
                await store.loadAllPositions(owner);
            }
            const before = store.playbackPositions();
            const row = { ...position(11, 'a'), positionSeconds: 90 };
            let finishSave!: () => void;
            const persisted = new Promise<void>((resolve) => {
                finishSave = resolve;
            });
            savePlaybackPosition.mockReturnValueOnce(persisted);
            playbackUpdate(row);
            expect(savePlaybackPosition).toHaveBeenCalledWith('a', row);
            finishSave();
            await persisted;
            await Promise.resolve();
            if (owner) {
                expect(store.positionsPlaylistId()).toBe(owner);
                expect(store.playbackPositions()).toBe(before);
                expect(store.playbackPositions().get('episode_11')).toEqual(
                    position(11, owner)
                );
            } else {
                expect(store.positionsPlaylistId()).toBe('a');
                expect(store.playbackPositions().get('episode_11')).toEqual(
                    row
                );
            }
        }
    );

    it('distinguishes cold pending, success and failure and clears a previous owner immediately', async () => {
        let resolve!: (rows: PlaybackPositionData[]) => void;
        const store = createStore();
        expect(store.positionsLoadState()).toBe('idle');
        getAllPlaybackPositions.mockResolvedValueOnce([position(11, 'a')]);
        await store.loadAllPositions('a');
        getAllPlaybackPositions.mockImplementationOnce(
            () =>
                new Promise<PlaybackPositionData[]>((done) => {
                    resolve = done;
                })
        );
        const pending = store.loadAllPositions('b');
        expect(store.positionsPlaylistId()).toBe('b');
        expect(store.positionsLoadState()).toBe('loading');
        expect(store.playbackPositions().size).toBe(0);
        await requestStarted(getAllPlaybackPositions, 2);
        resolve([]);
        await pending;
        expect(store.positionsLoadState()).toBe('ready');
        getAllPlaybackPositions.mockRejectedValueOnce(new Error('read failed'));
        await expect(store.loadAllPositions('b')).rejects.toThrow(
            'read failed'
        );
        expect(store.positionsLoadState()).toBe('error');
        getAllPlaybackPositions.mockResolvedValueOnce([]);
        await store.loadAllPositions('b');
        expect(store.positionsLoadState()).toBe('ready');
    });

    it('invalidates pending reads on reset without deleting persisted data', async () => {
        let resolve!: (rows: PlaybackPositionData[]) => void;
        getAllPlaybackPositions.mockImplementationOnce(
            () =>
                new Promise<PlaybackPositionData[]>((done) => {
                    resolve = done;
                })
        );
        const store = createStore();
        const pending = store.loadAllPositions('a');
        await requestStarted(getAllPlaybackPositions);
        store.resetPlaybackPositions();
        resolve([position(11, 'a')]);
        await pending;
        expect(store.positionsPlaylistId()).toBeNull();
        expect(store.positionsLoadState()).toBe('idle');
        expect(store.playbackPositions().size).toBe(0);
    });

    it('overlays confirmed writes onto stale batch and per-item reads', async () => {
        let resolveBatch!: (rows: PlaybackPositionData[]) => void;
        let resolveItem!: (row: PlaybackPositionData) => void;
        getAllPlaybackPositions.mockImplementationOnce(
            () =>
                new Promise<PlaybackPositionData[]>((done) => {
                    resolveBatch = done;
                })
        );
        getPlaybackPosition.mockImplementationOnce(
            () =>
                new Promise<PlaybackPositionData>((done) => {
                    resolveItem = done;
                })
        );
        const store = createStore();
        const batch = store.loadAllPositions('a');
        const item = store.loadVodPosition('a', 11);
        const saved = {
            ...position(11, 'a'),
            contentType: 'vod' as const,
            positionSeconds: 100,
        };
        await store.savePosition('a', saved);
        resolveItem({ ...saved, positionSeconds: 20 });
        resolveBatch([{ ...saved, positionSeconds: 30 }]);
        await Promise.all([batch, item]);
        expect(store.playbackPositions().get('vod_11')).toEqual(saved);
    });

    it('ignores late writes, item reads, series reads and errors from the previous owner', async () => {
        let resolveSave!: () => void;
        let resolveItem!: (row: PlaybackPositionData) => void;
        let resolveSeries!: (rows: PlaybackPositionData[]) => void;
        let rejectBatch!: (error: Error) => void;
        getAllPlaybackPositions.mockResolvedValueOnce([]);
        const store = createStore();
        await store.loadAllPositions('a');
        savePlaybackPosition.mockImplementationOnce(
            () =>
                new Promise<void>((done) => {
                    resolveSave = done;
                })
        );
        getPlaybackPosition.mockImplementationOnce(
            () =>
                new Promise<PlaybackPositionData>((done) => {
                    resolveItem = done;
                })
        );
        getSeriesPlaybackPositions.mockImplementationOnce(
            () =>
                new Promise<PlaybackPositionData[]>((done) => {
                    resolveSeries = done;
                })
        );
        getAllPlaybackPositions
            .mockImplementationOnce(
                () =>
                    new Promise<PlaybackPositionData[]>((_, reject) => {
                        rejectBatch = reject;
                    })
            )
            .mockResolvedValueOnce([]);
        const save = store.savePosition('a', position(1, 'a'));
        const item = store.loadVodPosition('a', 2);
        const series = store.loadSeriesPositions('a', 7);
        await Promise.all([
            requestStarted(savePlaybackPosition),
            requestStarted(getPlaybackPosition),
            requestStarted(getSeriesPlaybackPositions),
        ]);
        const oldBatch = store.loadAllPositions('a');
        const handledOldBatch = expect(oldBatch).rejects.toThrow('old error');
        await Promise.all([
            requestStarted(savePlaybackPosition),
            requestStarted(getPlaybackPosition),
            requestStarted(getSeriesPlaybackPositions),
            requestStarted(getAllPlaybackPositions, 2),
        ]);
        await store.loadAllPositions('b');
        resolveSave();
        resolveItem(position(2, 'a'));
        resolveSeries([position(3, 'a')]);
        rejectBatch(new Error('old error'));
        await Promise.all([save, item, series, handledOldBatch]);
        expect(store.positionsPlaylistId()).toBe('b');
        expect(store.positionsLoadState()).toBe('ready');
        expect(store.playbackPositions().size).toBe(0);
        expect(store.seriesPositions().size).toBe(0);
    });

    it('replaces an emptied series read without retaining old progress', async () => {
        const store = createStore();
        getSeriesPlaybackPositions
            .mockResolvedValueOnce([position(1, 'a')])
            .mockResolvedValueOnce([]);
        await store.loadSeriesPositions('a', 7);
        expect(store.hasSeriesProgress(7)).toBe(true);
        await store.loadSeriesPositions('a', 7);
        expect(store.hasSeriesProgress(7)).toBe(false);
        expect(store.playbackPositions().has('episode_1')).toBe(false);
    });

    it('keeps a newer confirmed episode write when an older series read returns empty', async () => {
        let resolve!: (rows: PlaybackPositionData[]) => void;
        getSeriesPlaybackPositions.mockImplementationOnce(
            () =>
                new Promise<PlaybackPositionData[]>((done) => {
                    resolve = done;
                })
        );
        const store = createStore();
        const read = store.loadSeriesPositions('a', 7);
        await store.savePosition('a', position(1, 'a'));
        resolve([]);
        await read;
        expect(store.hasSeriesProgress(7)).toBe(true);
        expect(store.playbackPositions().get('episode_1')).toEqual(
            position(1, 'a')
        );
    });

    it.each(['vod', 'episode'] as const)(
        'discards an older %s read when a newer batch starts',
        async (type) => {
            let resolveRead!: (row: PlaybackPositionData) => void;
            let resolveBatch!: (rows: PlaybackPositionData[]) => void;
            const old = {
                ...position(11, 'a'),
                contentType: type,
                positionSeconds: 20,
            };
            const fresh = { ...old, positionSeconds: 100 };
            if (type === 'vod') {
                getPlaybackPosition.mockImplementationOnce(
                    () =>
                        new Promise<PlaybackPositionData>((done) => {
                            resolveRead = done;
                        })
                );
            } else {
                getSeriesPlaybackPositions.mockImplementationOnce(
                    () =>
                        new Promise<PlaybackPositionData[]>((done) => {
                            resolveRead = (row) => done([row]);
                        })
                );
            }
            getAllPlaybackPositions.mockImplementationOnce(
                () =>
                    new Promise<PlaybackPositionData[]>((done) => {
                        resolveBatch = done;
                    })
            );
            const store = createStore();
            const read =
                type === 'vod'
                    ? store.loadVodPosition('a', 11)
                    : store.loadSeriesPositions('a', 7);
            await requestStarted(
                type === 'vod'
                    ? getPlaybackPosition
                    : getSeriesPlaybackPositions
            );
            const batch = store.loadAllPositions('a');
            await Promise.all([
                requestStarted(getAllPlaybackPositions),
                requestStarted(
                    type === 'vod'
                        ? getPlaybackPosition
                        : getSeriesPlaybackPositions
                ),
            ]);
            resolveRead(old);
            await read;
            expect(store.playbackPositions().has(`${type}_11`)).toBe(false);
            resolveBatch([fresh]);
            await batch;
            expect(store.playbackPositions().get(`${type}_11`)).toEqual(fresh);
        }
    );

    it.each(['vod', 'episode'] as const)(
        'does not journal a %s read as a confirmed write over batch results',
        async (type) => {
            let resolveRead!: (row: PlaybackPositionData) => void;
            let resolveBatch!: (rows: PlaybackPositionData[]) => void;
            const old = {
                ...position(11, 'a'),
                contentType: type,
                positionSeconds: 20,
            };
            const fresh = { ...old, positionSeconds: 100 };
            if (type === 'vod') {
                getPlaybackPosition.mockImplementationOnce(
                    () =>
                        new Promise<PlaybackPositionData>((done) => {
                            resolveRead = done;
                        })
                );
            } else {
                getSeriesPlaybackPositions.mockImplementationOnce(
                    () =>
                        new Promise<PlaybackPositionData[]>((done) => {
                            resolveRead = (row) => done([row]);
                        })
                );
            }
            getAllPlaybackPositions.mockImplementationOnce(
                () =>
                    new Promise<PlaybackPositionData[]>((done) => {
                        resolveBatch = done;
                    })
            );
            const store = createStore();
            const batch = store.loadAllPositions('a');
            const read =
                type === 'vod'
                    ? store.loadVodPosition('a', 11)
                    : store.loadSeriesPositions('a', 7);
            await Promise.all([
                requestStarted(getAllPlaybackPositions),
                requestStarted(
                    type === 'vod'
                        ? getPlaybackPosition
                        : getSeriesPlaybackPositions
                ),
            ]);
            resolveRead(old);
            await read;
            resolveBatch([fresh]);
            await batch;
            expect(store.playbackPositions().get(`${type}_11`)).toEqual(fresh);
        }
    );

    it.each(['vod', 'episode'] as const)(
        'does not apply a stale %s read after its concurrent batch completes',
        async (type) => {
            let resolveRead!: (row: PlaybackPositionData) => void;
            let resolveBatch!: (rows: PlaybackPositionData[]) => void;
            const old = {
                ...position(11, 'a'),
                contentType: type,
                positionSeconds: 20,
            };
            if (type === 'vod') {
                getPlaybackPosition.mockImplementationOnce(
                    () =>
                        new Promise<PlaybackPositionData>((done) => {
                            resolveRead = done;
                        })
                );
            } else {
                getSeriesPlaybackPositions.mockImplementationOnce(
                    () =>
                        new Promise<PlaybackPositionData[]>((done) => {
                            resolveRead = (row) => done([row]);
                        })
                );
            }
            getAllPlaybackPositions.mockImplementationOnce(
                () =>
                    new Promise<PlaybackPositionData[]>((done) => {
                        resolveBatch = done;
                    })
            );
            const store = createStore();
            const batch = store.loadAllPositions('a');
            const read =
                type === 'vod'
                    ? store.loadVodPosition('a', 11)
                    : store.loadSeriesPositions('a', 7);
            await Promise.all([
                requestStarted(getAllPlaybackPositions),
                requestStarted(
                    type === 'vod'
                        ? getPlaybackPosition
                        : getSeriesPlaybackPositions
                ),
            ]);
            resolveBatch([]);
            await batch;
            await Promise.all([
                requestStarted(getAllPlaybackPositions),
                requestStarted(
                    type === 'vod'
                        ? getPlaybackPosition
                        : getSeriesPlaybackPositions
                ),
            ]);
            resolveRead(old);
            await read;
            expect(store.playbackPositions().has(`${type}_11`)).toBe(false);
        }
    );

    it('loads positions into the store maps', async () => {
        getAllPlaybackPositions.mockResolvedValue([position(11, 'playlist-a')]);
        const store = createStore();

        await store.loadAllPositions('playlist-a');

        expect(store.playbackPositions().get('episode_11')).toBeDefined();
        expect(store.hasSeriesProgress(7)).toBe(true);
    });

    it('keeps the cached maps when a refresh read fails', async () => {
        getAllPlaybackPositions.mockResolvedValueOnce([
            position(11, 'playlist-a'),
        ]);
        const store = createStore();
        await store.loadAllPositions('playlist-a');

        getAllPlaybackPositions.mockRejectedValueOnce(new Error('ipc down'));
        await expect(store.loadAllPositions('playlist-a')).rejects.toThrow(
            'ipc down'
        );

        expect(store.playbackPositions().get('episode_11')).toBeDefined();
        expect(store.hasSeriesProgress(7)).toBe(true);
    });

    it('discards a superseded load so a late result cannot overwrite the newer playlist', async () => {
        let resolveFirst!: (rows: PlaybackPositionData[]) => void;
        getAllPlaybackPositions
            .mockImplementationOnce(
                () =>
                    new Promise<PlaybackPositionData[]>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce([position(22, 'playlist-b')]);
        const store = createStore();

        const stale = store.loadAllPositions('playlist-a');
        await requestStarted(getAllPlaybackPositions);
        await store.loadAllPositions('playlist-b');

        resolveFirst([position(11, 'playlist-a')]);
        await stale;

        expect(store.playbackPositions().has('episode_11')).toBe(false);
        expect(store.playbackPositions().get('episode_22')).toBeDefined();
    });
});
