import { TestBed } from '@angular/core/testing';
import { DataService } from './data.service';
import { DatabaseService } from './database-electron.service';
import { ParentalLockService } from './parental-lock';
import { PlaybackPositionService } from './playback-position.service';
import { SourceActivityService } from './source-activity.service';
import { XtreamPendingRestoreService } from './xtream-pending-restore.service';
import { XtreamSelectedCatalogRefreshService } from './xtream-selected-catalog-refresh.service';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';

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
            { contentType: 'live', xtreamId: 42, viewedAt: '2026-01-01' },
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
        | 'getAllXtreamCategories',
        jest.Mock
    >;
    let pending: Record<string, jest.Mock>;
    let release: jest.Mock;
    let service: XtreamSelectedCatalogRefreshService;

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
                'getAllXtreamCategories',
            ].map((name) => [name, jest.fn().mockResolvedValue(undefined)])
        ) as typeof db;
        db.deleteXtreamPlaylistContent.mockResolvedValue(saved);
        db.getAllXtreamCategories.mockResolvedValue([]);
        db.getRecentItemsOrThrow.mockResolvedValue([
            { type: 'live', xtream_id: 42, viewed_at: '2026-01-01' },
        ]);
        const snapshot = {
            playlistId: 'p',
            revision: 1,
            state: { ...saved, playbackPositions: [] },
        };
        pending = {
            getOrThrow: jest.fn().mockReturnValue(null),
            set: jest.fn().mockReturnValue(true),
            getSnapshotOrThrow: jest.fn().mockReturnValue(snapshot),
            applyAndConsume: jest
                .fn()
                .mockImplementation(async (_id, _snapshot, apply) => {
                    await apply(snapshot.state);
                    return 'consumed';
                }),
        };
        release = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: DataService, useValue: data },
                { provide: DatabaseService, useValue: db },
                {
                    provide: ParentalLockService,
                    useValue: { lockedXtreamIds: () => [] },
                },
                {
                    provide: PlaybackPositionService,
                    useValue: {
                        getAllPlaybackPositionsOrThrow: jest
                            .fn()
                            .mockResolvedValue([]),
                    },
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
        expect(db.setXtreamImportStatus).toHaveBeenCalledWith(
            'p',
            'movie',
            'completed'
        );
        expect(db.restoreXtreamUserData).toHaveBeenCalledWith(
            'p',
            [],
            saved.recentlyViewed
        );
        expect(release).toHaveBeenCalled();
    });

    it('does not delete data when history cannot be read', async () => {
        db.getRecentItemsOrThrow.mockRejectedValue(
            new Error('history unreadable')
        );
        await expect(service.refresh(playlist, ['movie'])).rejects.toThrow(
            'history unreadable'
        );
        expect(pending['set']).not.toHaveBeenCalled();
        expect(db.deleteXtreamPlaylistContent).not.toHaveBeenCalled();
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
    });
});
