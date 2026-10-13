import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    DatabaseService,
    PlaylistDeleteActionService,
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import {
    SOURCE_REMOVAL_UNDO_MS,
    SourceRemovalService,
} from './source-removal.service';

const playlist = (id: string): PlaylistMeta => ({
    _id: id,
    title: id,
    count: 0,
    importDate: '',
    autoRefresh: false,
});

describe('SourceRemovalService', () => {
    let toasts: Array<{
        message: string;
        data: { commitNow?: () => void };
        action: Subject<void>;
        dismissed: Subject<void>;
        dismiss: jest.Mock;
    }>;
    let deletePlaylist: jest.Mock;
    let cancelOperation: jest.Mock;
    let dispatch: jest.Mock;
    let resolvedPlaylistId: ReturnType<typeof signal<string | null>>;
    let routePlaylistId: ReturnType<typeof signal<string | null>>;
    let context: {
        resolvedPlaylistId: typeof resolvedPlaylistId;
        routePlaylistId: typeof routePlaylistId;
        selectPlaylist: jest.Mock;
        activatePlaylist: jest.Mock;
    };
    let router: { url: string; navigate: jest.Mock; navigateByUrl: jest.Mock };
    let service: SourceRemovalService;

    const toast = (message: string, data: { commitNow?: () => void } = {}) => {
        const dismissed = new Subject<void>();
        const entry: (typeof toasts)[number] = {
            message,
            data,
            action: new Subject<void>(),
            dismissed,
            dismiss: jest.fn(() => dismissed.next()),
        };
        toasts.push(entry);
        return {
            onAction: () => entry.action,
            afterDismissed: () => entry.dismissed,
            dismiss: entry.dismiss,
        };
    };

    /** The Undo window ends: the service's own timer commits. */
    const expireUndo = () => jest.advanceTimersByTime(SOURCE_REMOVAL_UNDO_MS);

    const flush = async () => {
        await Promise.resolve();
        await Promise.resolve();
    };

    beforeEach(() => {
        jest.useFakeTimers();
        toasts = [];
        deletePlaylist = jest.fn().mockResolvedValue(true);
        cancelOperation = jest.fn().mockResolvedValue(true);
        dispatch = jest.fn();
        resolvedPlaylistId = signal<string | null>(null);
        routePlaylistId = signal<string | null>(null);
        context = {
            resolvedPlaylistId,
            routePlaylistId,
            selectPlaylist: jest.fn((p: PlaylistMeta) =>
                resolvedPlaylistId.set(p._id)
            ),
            activatePlaylist: jest.fn(),
        };
        router = {
            url: '/workspace/sources',
            navigate: jest.fn().mockResolvedValue(true),
            navigateByUrl: jest.fn().mockResolvedValue(true),
        };
        TestBed.configureTestingModule({
            imports: [TranslateModule.forRoot()],
            providers: [
                SourceRemovalService,
                {
                    provide: MatSnackBar,
                    useValue: {
                        open: jest.fn((message: string) => toast(message)),
                        openFromComponent: jest.fn(
                            (
                                _component: unknown,
                                config: {
                                    data: {
                                        message: string;
                                        commitNow?: () => void;
                                    };
                                }
                            ) => toast(config.data.message, config.data)
                        ),
                    },
                },
                {
                    provide: PlaylistDeleteActionService,
                    useValue: { deletePlaylist },
                },
                { provide: PlaylistContextFacade, useValue: context },
                { provide: Router, useValue: router },
                { provide: Store, useValue: { dispatch } },
                { provide: DatabaseService, useValue: { cancelOperation } },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: true },
                },
            ],
        });
        service = TestBed.inject(SourceRemovalService);
    });
    afterEach(() => jest.useRealTimers());

    it('hides the source and deletes it only when the Undo window ends', async () => {
        const a = playlist('a');
        service.remove(a);
        expect(service.isPending('a')).toBe(true);
        expect(deletePlaylist).not.toHaveBeenCalled();
        expect(toasts[0].message).toBe('WORKSPACE.SOURCES.REMOVED');

        expireUndo();
        await flush();
        expect(deletePlaylist).toHaveBeenCalledWith(a, {
            onEvent: expect.any(Function),
        });
        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.playlistRemovalCommitted({ playlistId: 'a' })
        );
        expect(service.isPending('a')).toBe(false);
    });

    it('does not remove a source while a refresh clears and refills it', async () => {
        // Any entry point's refresh, or the startup auto-refresh.
        const release = TestBed.inject(SourceActivityService).begin(['a']);
        service.remove(playlist('a'));
        expireUndo();
        await flush();
        expect(service.isPending('a')).toBe(false);
        expect(toasts).toHaveLength(0);
        expect(deletePlaylist).not.toHaveBeenCalled();
        release();
    });

    it('restores the source on Undo without deleting anything', async () => {
        service.remove(playlist('a'));
        toasts[0].action.next();
        toasts[0].dismissed.next();
        expireUndo();
        await flush();
        expect(service.isPending('a')).toBe(false);
        expect(deletePlaylist).not.toHaveBeenCalled();
    });

    it('keeps the full Undo window when another message replaces the toast', async () => {
        service.remove(playlist('a'));
        // A refresh finishing elsewhere opens its own snack bar.
        toasts[0].dismissed.next();
        jest.advanceTimersByTime(SOURCE_REMOVAL_UNDO_MS - 1);
        await flush();
        expect(deletePlaylist).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        await flush();
        expect(deletePlaylist).toHaveBeenCalledTimes(1);
    });

    it('commits at once from the close button, and only once', async () => {
        service.remove(playlist('a'));
        toasts[0].data.commitNow?.();
        await flush();
        expect(deletePlaylist).toHaveBeenCalledTimes(1);
        expect(toasts[0].dismiss).toHaveBeenCalled();

        expireUndo();
        await flush();
        expect(deletePlaylist).toHaveBeenCalledTimes(1);
    });

    it('commits an earlier removal when a second one starts', async () => {
        service.remove(playlist('a'));
        service.remove(playlist('b'));
        await flush();
        expect(toasts[0].dismiss).toHaveBeenCalled();
        expect(deletePlaylist).toHaveBeenCalledTimes(1);
        expect(service.isPending('b')).toBe(true);
    });

    it('switches away from the active source and back on Undo', () => {
        resolvedPlaylistId.set('a');
        service.remove(playlist('a'), playlist('b'));
        expect(context.selectPlaylist).toHaveBeenCalledWith(playlist('b'));
        expect(toasts[0].message).toBe('WORKSPACE.SOURCES.REMOVED_SWITCHED');

        toasts[0].action.next();
        expect(context.activatePlaylist).toHaveBeenCalledWith('a');
    });

    it('does not hand over to a source that is being deleted', () => {
        resolvedPlaylistId.set('a');
        service.progress.track('b', {
            operation: 'delete-playlist',
            status: 'started',
        });
        service.remove(playlist('a'), playlist('b'));
        expect(context.selectPlaylist).not.toHaveBeenCalled();
        expect(toasts[0].message).toBe('WORKSPACE.SOURCES.REMOVED');
    });

    it('does not hand over to a source a refresh or import holds', () => {
        resolvedPlaylistId.set('a');
        const release = TestBed.inject(SourceActivityService).begin(['b']);
        service.remove(playlist('a'), playlist('b'));
        expect(context.selectPlaylist).not.toHaveBeenCalled();
        expect(toasts[0].message).toBe('WORKSPACE.SOURCES.REMOVED');
        release();
    });

    it('leaves a switch the user made after the delete alone on Undo', () => {
        resolvedPlaylistId.set('a');
        service.remove(playlist('a'), playlist('b'));
        resolvedPlaylistId.set('c');
        toasts[0].action.next();
        expect(context.activatePlaylist).not.toHaveBeenCalled();
    });

    it('leaves a later switch alone on Undo when nothing replaced the source', () => {
        // The source was the only row a filter showed: no replacement.
        resolvedPlaylistId.set('a');
        routePlaylistId.set('a');
        router.url = '/workspace/xtreams/a/vod';
        service.remove(playlist('a'));
        resolvedPlaylistId.set('c');

        toasts[0].action.next();
        expect(router.navigateByUrl).not.toHaveBeenCalled();
        expect(context.activatePlaylist).not.toHaveBeenCalled();
    });

    it('passes the focus target of a closing surface to the toast', () => {
        const trigger = document.createElement('button');
        service.remove(playlist('a'), null, { returnFocusTo: trigger });
        const openFromComponent = TestBed.inject(MatSnackBar)
            .openFromComponent as jest.Mock;
        expect(openFromComponent.mock.calls[0][1].data.returnFocusTo).toBe(
            trigger
        );
    });

    it('leaves the deleted source’s own page and returns on Undo', () => {
        resolvedPlaylistId.set('a');
        routePlaylistId.set('a');
        router.url = '/workspace/xtreams/a/vod';
        service.remove(playlist('a'));
        expect(router.navigate).toHaveBeenCalledWith(['/workspace', 'sources']);

        toasts[0].action.next();
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            '/workspace/xtreams/a/vod'
        );
    });

    it('shows a desktop Xtream row as removing as soon as the delete starts', async () => {
        deletePlaylist.mockReturnValue(new Promise(() => undefined));
        service.remove({ ...playlist('x'), serverUrl: 'http://x.test' });
        expect(service.isPending('x')).toBe(true);
        expireUndo();
        await flush();
        expect(service.isPending('x')).toBe(false);
        expect(service.progress.isDeleting('x')).toBe(true);
        expect(service.progress.message('x')).toBe(
            'HOME.PLAYLISTS.REMOVE_DIALOG.IN_PROGRESS'
        );
    });

    it('times an Xtream row leaving the store for the performance journeys', async () => {
        const events: RendererPerformancePhaseEvent[] = [];
        const hook = Symbol.for(RENDERER_PERFORMANCE_PHASE_HOOK_KEY);
        const target = globalThis as unknown as Record<symbol, unknown>;
        target[hook] = (event: RendererPerformancePhaseEvent) =>
            events.push(event);
        try {
            service.remove({ ...playlist('x'), serverUrl: 'http://x.test' });
            expireUndo();
            await flush();
        } finally {
            delete target[hook];
        }
        expect(events.map(({ boundary, phase }) => [boundary, phase])).toEqual([
            ['start', 'store.xtream-delete-row'],
            ['end', 'store.xtream-delete-row'],
        ]);
    });

    it('shows a long delete on its row and keeps the source on Cancel', async () => {
        let finish!: (deleted: boolean) => void;
        deletePlaylist.mockImplementation(
            (
                _playlist: PlaylistMeta,
                options: { onEvent: (event: object) => void }
            ) => {
                options.onEvent({
                    operation: 'delete-playlist',
                    operationId: 'op-1',
                    status: 'progress',
                    phase: 'deleting-content',
                    current: 1,
                    total: 4,
                });
                return new Promise<boolean>((resolve) => (finish = resolve));
            }
        );
        service.remove(playlist('x'));
        expireUndo();
        await flush();

        // The row is back, in its busy state.
        expect(service.isPending('x')).toBe(false);
        expect(service.progress.isDeleting('x')).toBe(true);
        expect(service.progress.message('x')).toBe(
            'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_CONTENT'
        );
        expect(service.progress.progress('x')).toBe(25);

        await service.progress.cancel('x');
        expect(cancelOperation).toHaveBeenCalledWith('op-1');
        finish(false);
        await flush();
        expect(service.progress.isDeleting('x')).toBe(false);
        expect(dispatch).not.toHaveBeenCalled();
        // A cancel is not a failure.
        expect(toasts).toHaveLength(1);
    });

    it('keeps a deleted row busy until the whole delete has settled', async () => {
        let finish!: (deleted: boolean) => void;
        deletePlaylist.mockImplementation(
            (
                _playlist: PlaylistMeta,
                options: { onEvent: (event: object) => void }
            ) => {
                options.onEvent({
                    operation: 'delete-playlist',
                    operationId: 'op-2',
                    status: 'completed',
                });
                return new Promise<boolean>((resolve) => (finish = resolve));
            }
        );
        service.remove({ ...playlist('x'), serverUrl: 'http://x.test' });
        expireUndo();
        await flush();

        // The database is done, its cleanup is not: no Cancel, still busy.
        expect(service.progress.isDeleting('x')).toBe(true);
        expect(service.progress.canCancel('x')).toBe(false);
        expect(dispatch).not.toHaveBeenCalled();

        finish(true);
        await flush();
        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.playlistRemovalCommitted({ playlistId: 'x' })
        );
        expect(service.progress.isDeleting('x')).toBe(false);
    });

    it('brings the source back and says so when the delete fails', async () => {
        deletePlaylist.mockResolvedValue(false);
        service.remove(playlist('a'));
        expireUndo();
        await flush();
        expect(dispatch).not.toHaveBeenCalled();
        expect(service.isPending('a')).toBe(false);
        expect(toasts[1].message).toBe('WORKSPACE.SOURCES.REMOVE_FAILED');
    });
});
