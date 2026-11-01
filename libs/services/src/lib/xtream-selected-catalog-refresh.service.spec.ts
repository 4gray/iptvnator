import { TestBed } from '@angular/core/testing';
import { DataService } from './data.service';
import { DatabaseService } from './database-electron.service';
import { ParentalLockService } from './parental-lock';
import { SourceActivityService } from './source-activity.service';
import {
    XtreamPendingRestoreService,
    XtreamPendingRestoreSnapshot,
} from './xtream-pending-restore.service';
import { XtreamSelectedCatalogRefreshService } from './xtream-selected-catalog-refresh.service';
import {
    XtreamCatalogCommitService,
    XtreamCatalogConnectionChangedError,
} from './xtream-catalog-commit.service';
import {
    PlaylistMeta,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

const playlist = {
    _id: 'p',
    serverUrl: 'https://example.invalid',
    username: 'u',
    password: 'p',
} as PlaylistMeta;

describe('edit-time Xtream catalog refresh', () => {
    const saved = {
        success: true,
        favorites: [],
        hiddenCategories: [],
        recentlyViewed: [
            {
                contentType: 'live' as const,
                xtreamId: 42,
                viewedAt: '2026-01-01',
            },
        ],
    };
    let data: { sendIpcEvent: jest.Mock };
    let db: Record<
        | 'deleteXtreamPlaylistContent'
        | 'saveXtreamCategories'
        | 'saveXtreamContent'
        | 'setXtreamImportStatus'
        | 'restoreXtreamUserData'
        | 'getRecentItemsOrThrow'
        | 'getXtreamImportStatus'
        | 'getAllXtreamCategories'
        | 'clearXtreamImportCache'
        | 'setAppState'
        | 'readAppState',
        jest.Mock
    >;
    let pending: Record<string, jest.Mock>;
    let release: jest.Mock;
    let service: XtreamSelectedCatalogRefreshService;
    let commitState: jest.Mock;
    let assertCurrent: jest.Mock;

    beforeEach(() => {
        data = { sendIpcEvent: jest.fn().mockResolvedValue({ payload: [] }) };
        db = Object.fromEntries(
            [
                'deleteXtreamPlaylistContent',
                'saveXtreamCategories',
                'saveXtreamContent',
                'setXtreamImportStatus',
                'restoreXtreamUserData',
                'getRecentItemsOrThrow',
                'getXtreamImportStatus',
                'getAllXtreamCategories',
                'clearXtreamImportCache',
                'setAppState',
                'readAppState',
            ].map((name) => [name, jest.fn().mockResolvedValue(undefined)])
        ) as typeof db;
        db.deleteXtreamPlaylistContent.mockResolvedValue(saved);
        db.clearXtreamImportCache.mockResolvedValue(true);
        const appState = new Map<string, string>();
        db.setAppState.mockImplementation(async (key, value) => {
            appState.set(key, value);
            return true;
        });
        db.readAppState.mockImplementation(async (key) => ({
            value: appState.get(key) ?? null,
        }));
        db.setXtreamImportStatus.mockResolvedValue(true);
        db.getAllXtreamCategories.mockResolvedValue([]);
        db.getXtreamImportStatus.mockResolvedValue('completed');
        db.getRecentItemsOrThrow.mockResolvedValue([
            { type: 'live', xtream_id: 42, viewed_at: '2026-01-01' },
        ]);
        let snapshot: XtreamPendingRestoreSnapshot = {
            playlistId: 'p',
            revision: 1,
            state: { ...saved, playbackPositions: [] },
        };
        pending = {
            getOrThrow: jest.fn().mockReturnValue(null),
            set: jest.fn((_id: string, state: XtreamPendingRestoreState) => {
                snapshot = { ...snapshot, state };
                return snapshot;
            }),
            clear: jest.fn().mockReturnValue(true),
            getSnapshotOrThrow: jest.fn(() => snapshot),
            applyAndConsume: jest
                .fn()
                .mockImplementation(async (_id, _snapshot, apply) => {
                    await apply(_snapshot.state);
                    return 'consumed';
                }),
        };
        release = jest.fn();
        assertCurrent = jest.fn().mockResolvedValue(undefined);
        commitState = jest.fn(async (_playlist, key, value) => {
            const saved =
                value === 'completed'
                    ? await db.setXtreamImportStatus(
                          'p',
                          key.split(':').at(-1),
                          value
                      )
                    : await db.setAppState(key, value);
            if (!saved)
                throw new Error('Could not persist catalog completion status.');
        });
        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: data },
                { provide: DatabaseService, useValue: db },
                {
                    provide: XtreamCatalogCommitService,
                    useValue: { setState: commitState, assertCurrent },
                },
                {
                    provide: ParentalLockService,
                    useValue: { lockedXtreamIds: () => [] },
                },
                {
                    provide: SourceActivityService,
                    useValue: { isBusy: () => false, begin: () => release },
                },
                { provide: XtreamPendingRestoreService, useValue: pending },
            ],
        });
        service = TestBed.inject(XtreamSelectedCatalogRefreshService);
    });

    it('immediately refreshes Movies only and restores history including other types', async () => {
        await service.refresh(playlist, ['movie']);
        expect(
            data.sendIpcEvent.mock.calls.map((call) => call[1].params.action)
        ).toEqual(['get_vod_categories', 'get_vod_streams']);
        expect(db.deleteXtreamPlaylistContent).toHaveBeenCalledWith('p', {
            contentTypes: ['movie'],
        });
        expect(pending['set']).toHaveBeenCalledWith(
            'p',
            expect.objectContaining({ preservePlaybackPositions: true })
        );
        expect(db.setXtreamImportStatus).toHaveBeenCalledWith(
            'p',
            'movie',
            'completed'
        );
        expect(db.restoreXtreamUserData).toHaveBeenCalledWith('p', [], []);
        expect(release).toHaveBeenCalled();
    });

    it.each(['serverUrl', 'username', 'password', 'userAgent'] as const)(
        'rejects catalogs fetched before the accepted %s changed',
        async (field) => {
            const accepted = {
                ...playlist,
                [field]:
                    field === 'serverUrl'
                        ? 'https://changed.example.invalid'
                        : 'new-connection',
            };
            await expect(
                service.refresh(playlist, ['movie'], async () => accepted)
            ).rejects.toThrow('connection changed');
            expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
            expect(db.saveXtreamCategories).not.toHaveBeenCalled();
            expect(db.saveXtreamContent).not.toHaveBeenCalled();
            expect(pending['applyAndConsume']).not.toHaveBeenCalled();
            expect(pending['clear']).toHaveBeenCalled();
            expect(release).toHaveBeenCalled();
        }
    );

    it('accepts normalized equivalent connections and unrelated metadata edits', async () => {
        await service.refresh(playlist, ['movie'], async () => ({
            ...playlist,
            username: ' u ',
            password: ' p ',
            userAgent: ' ',
            title: 'Updated synthetic source',
        }));
        expect(db.saveXtreamContent).toHaveBeenCalled();
        expect(pending['applyAndConsume']).toHaveBeenCalled();
    });

    it.each(['series', 'acknowledgment'])(
        'clears all replaced types and retains recovery after a late connection change at %s',
        async (phase) => {
            const original = commitState.getMockImplementation()!;
            commitState.mockImplementation(async (source, key, value) => {
                if (
                    (phase === 'series' && key.endsWith(':series')) ||
                    (phase === 'acknowledgment' && value === '')
                ) {
                    throw new XtreamCatalogConnectionChangedError();
                }
                return original(source, key, value);
            });
            await expect(
                service.refresh(playlist, ['movie', 'series'])
            ).rejects.toThrow('connection changed');
            expect(db.setXtreamImportStatus).toHaveBeenCalledWith(
                'p',
                'movie',
                'completed'
            );
            expect(db.clearXtreamImportCache.mock.calls).toEqual([
                ['p', 'movie'],
                ['p', 'series'],
            ]);
            expect(pending['clear']).not.toHaveBeenCalled();
            expect(db.setAppState).not.toHaveBeenCalledWith(
                'xtream-history-recovery:p',
                ''
            );
            expect(release).toHaveBeenCalled();
        }
    );

    it('clears an earlier completed type if a save error also moved the connection', async () => {
        db.saveXtreamContent.mockImplementation(async (_id, _rows, type) => {
            if (type === 'series') throw new Error('Synthetic save failure');
            return 0;
        });
        assertCurrent.mockRejectedValue(
            new XtreamCatalogConnectionChangedError()
        );
        await expect(
            service.refresh(playlist, ['movie', 'series'])
        ).rejects.toThrow('Synthetic save failure');
        expect(assertCurrent).toHaveBeenCalledWith(playlist);
        expect(db.clearXtreamImportCache.mock.calls).toEqual([
            ['p', 'movie'],
            ['p', 'series'],
        ]);
        expect(pending['clear']).not.toHaveBeenCalled();
        expect(db.setAppState).not.toHaveBeenCalledWith(
            'xtream-history-recovery:p',
            ''
        );
    });

    it('durably marks each invalidated catalog before any replacement write', async () => {
        await service.refresh(playlist, ['movie']);
        const marks = db.setXtreamImportStatus.mock.calls
            .map((call, index) => ({
                call,
                order: db.setXtreamImportStatus.mock.invocationCallOrder[index],
            }))
            .filter(({ call }) => call[2] === 'importing');
        expect(marks).toHaveLength(1);
        expect(marks[0].order).toBeGreaterThan(
            db.deleteXtreamPlaylistContent.mock.invocationCallOrder[0]
        );
        expect(marks[0].order).toBeLessThan(
            db.saveXtreamCategories.mock.invocationCallOrder[0]
        );
    });

    it('leaves healthy caches untouched when native deletion preparation fails', async () => {
        db.deleteXtreamPlaylistContent.mockRejectedValue(
            new Error('could not begin deletion')
        );
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'could not begin deletion'
        );
        expect(db.clearXtreamImportCache).not.toHaveBeenCalled();
        expect(db.setXtreamImportStatus).not.toHaveBeenCalled();
        expect(db.saveXtreamCategories).not.toHaveBeenCalled();
        expect(pending['applyAndConsume']).not.toHaveBeenCalled();
    });

    it('does not authorize cleanup when native invalidation returns false', async () => {
        db.deleteXtreamPlaylistContent.mockResolvedValue({
            ...saved,
            success: false,
        });
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'invalidate catalog'
        );
        expect(db.clearXtreamImportCache).not.toHaveBeenCalled();
        expect(db.setXtreamImportStatus).not.toHaveBeenCalled();
        expect(pending['applyAndConsume']).not.toHaveBeenCalled();
    });

    it('does not mutate retained state when the metadata save is rejected after fetching', async () => {
        const authorize = jest
            .fn()
            .mockRejectedValue(new Error('source conflict'));
        await expect(
            service.refresh(playlist, ['movie'], authorize)
        ).rejects.toThrow('source conflict');
        expect(data.sendIpcEvent).toHaveBeenCalledTimes(2);
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
        expect(db.saveXtreamContent).not.toHaveBeenCalled();
        expect(pending['set']).toHaveBeenCalled();
        expect(pending['clear']).toHaveBeenCalled();
        expect(db.setAppState).toHaveBeenLastCalledWith(
            'xtream-history-recovery:p',
            ''
        );
        expect(pending['applyAndConsume']).not.toHaveBeenCalled();
        expect(service.progress()).toBeNull();
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('does not confirm an edit or mutate cache while an earlier restore is pending', async () => {
        pending['getOrThrow'].mockReturnValue({
            ...saved,
            playbackPositions: [],
        });
        const authorize = jest.fn();
        await expect(
            service.refresh(playlist, ['movie'], authorize)
        ).rejects.toThrow('current source import');
        expect(authorize).not.toHaveBeenCalled();
        expect(data.sendIpcEvent).not.toHaveBeenCalled();
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
        expect(db.clearXtreamImportCache).not.toHaveBeenCalled();
        expect(pending['set']).not.toHaveBeenCalled();
    });

    it('secures recovery before metadata confirmation and waits for acceptance before replacing catalogs', async () => {
        let confirm!: () => void;
        let observed!: () => void;
        const accepting = new Promise<void>((resolve) => {
            observed = resolve;
        });
        const authorize = jest.fn(() => {
            observed();
            return new Promise<void>((resolve) => {
                confirm = resolve;
            });
        });
        const refreshing = service.refresh(playlist, ['movie'], authorize);
        await accepting;
        expect(authorize).toHaveBeenCalledTimes(1);
        expect(pending['set']).toHaveBeenCalled();
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
        confirm();
        await refreshing;
        expect(db.deleteXtreamPlaylistContent).toHaveBeenCalledTimes(1);
    });

    it('publishes remote scanning state while a newly enabled type is loading', async () => {
        let respond!: (value: { payload: unknown[] }) => void;
        data.sendIpcEvent.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    respond = resolve;
                })
        );
        const refresh = service.refresh(playlist, ['series']);
        expect(service.progress()).toEqual({
            playlistId: 'p',
            type: 'series',
            phase: 'loading-categories',
            current: 0,
            total: 0,
        });
        respond({ payload: [] });
        await refresh;
        expect(service.progress()).toBeNull();
    });

    it('publishes actual SQLite save counts for only the refreshed type', async () => {
        db.saveXtreamContent.mockImplementation(
            async (_id, _content, type, _progress, options) => {
                expect(type).toBe('movie');
                options.onEvent({ status: 'progress', current: 5, total: 10 });
                expect(service.progress()).toEqual({
                    playlistId: 'p',
                    type: 'movie',
                    phase: 'saving-content',
                    current: 5,
                    total: 10,
                });
                return 0;
            }
        );
        await service.refresh(playlist, ['movie']);
        expect(service.progress()).toBeNull();
    });

    it('does not delete data when native history recovery cannot be retained', async () => {
        db.setAppState.mockResolvedValue(false);
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'Could not retain catalog history recovery.'
        );
        expect(pending['set']).toHaveBeenCalled();
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
    });

    it('does not accept source metadata before native recovery is secured', async () => {
        db.setAppState.mockResolvedValue(false);
        const accept = jest.fn().mockResolvedValue(undefined);
        await expect(
            service.refresh(playlist, ['movie'], accept)
        ).rejects.toThrow();
        expect(accept).not.toHaveBeenCalled();
    });

    it('does not delete data if parking recovery state fails', async () => {
        pending['set'].mockReturnValue(false);
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow();
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
    });

    it('parks history before deleting and retains recovery state if a cache write fails', async () => {
        db.saveXtreamCategories.mockRejectedValue(new Error('disk full'));
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'disk full'
        );
        expect(pending['set'].mock.invocationCallOrder[0]).toBeLessThan(
            db.deleteXtreamPlaylistContent.mock.invocationCallOrder[0]
        );
        expect(pending['applyAndConsume']).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalled();
    });

    it('retains recovery and clears unfinished rows when completion status is not persisted', async () => {
        db.setXtreamImportStatus.mockImplementation(
            async (_id, _type, status) => status !== 'completed'
        );
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'completion status'
        );
        expect(pending['applyAndConsume']).not.toHaveBeenCalled();
        expect(db.restoreXtreamUserData).not.toHaveBeenCalled();
        expect(db.clearXtreamImportCache).toHaveBeenCalledWith('p', 'movie');
        expect(db.setAppState).not.toHaveBeenCalledWith(
            'xtream-history-recovery:p',
            ''
        );
    });

    it('clears only unfinished types after a committed batch fails and keeps recovery parked', async () => {
        data.sendIpcEvent.mockResolvedValue({
            payload: [{ stream_id: 1, category_id: 1 }],
        });
        db.saveXtreamContent.mockImplementation(async (_id, _rows, type) => {
            if (type === 'movie') throw new Error('second transaction failed');
            return 1;
        });
        await expect(
            service.refresh(playlist, ['live', 'movie'])
        ).rejects.toThrow('second transaction failed');
        expect(db.clearXtreamImportCache).toHaveBeenCalledTimes(1);
        expect(db.clearXtreamImportCache).toHaveBeenCalledWith('p', 'movie');
        expect(db.setXtreamImportStatus).toHaveBeenCalledWith(
            'p',
            'live',
            'completed'
        );
        expect(db.setXtreamImportStatus).toHaveBeenCalledWith(
            'p',
            'movie',
            'failed'
        );
        expect(pending['applyAndConsume']).not.toHaveBeenCalled();
    });

    it('keeps healthy completed catalogs if only replay fails', async () => {
        pending['applyAndConsume'].mockRejectedValue(
            new Error('restore failed')
        );
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'restore failed'
        );
        expect(db.clearXtreamImportCache).not.toHaveBeenCalled();
    });

    it('reports cleanup failure without consuming the parked history', async () => {
        db.saveXtreamCategories.mockRejectedValue(new Error('disk full'));
        db.clearXtreamImportCache.mockResolvedValue(false);
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'incomplete catalog'
        );
        expect(pending['applyAndConsume']).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalled();
    });

    it('makes no requests or destructive writes for a disable-only edit', async () => {
        await service.refresh(playlist, []);
        expect(data.sendIpcEvent).not.toHaveBeenCalled();
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
    });

    it('retains existing data when the provider fails', async () => {
        data.sendIpcEvent.mockResolvedValue({ type: 'ERROR' });
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow();
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalled();
        expect(service.progress()).toBeNull();
    });

    it('preserves the source User-Agent for edit-time catalog requests', async () => {
        await service.refresh({ ...playlist, userAgent: ' Custom Player ' }, [
            'movie',
        ]);
        for (const [, request] of data.sendIpcEvent.mock.calls) {
            expect(request.userAgent).toBe('Custom Player');
            expect(request.params).not.toHaveProperty('userAgent');
        }
    });
});
