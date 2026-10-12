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
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    RENDERER_PERFORMANCE_PHASE_HOOK_KEY,
    type RendererPerformancePhaseEvent,
} from '@iptvnator/shared/logging';
import { SourceRemovalService } from './source-removal.service';

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

    const toast = (message: string) => {
        const dismissed = new Subject<void>();
        const entry: (typeof toasts)[number] = {
            message,
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

    const flush = async () => {
        await Promise.resolve();
        await Promise.resolve();
    };

    beforeEach(() => {
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
                                config: { data: { message: string } }
                            ) => toast(config.data.message)
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

    it('hides the source and deletes it only when the toast closes', async () => {
        const a = playlist('a');
        service.remove(a);
        expect(service.isPending('a')).toBe(true);
        expect(deletePlaylist).not.toHaveBeenCalled();
        expect(toasts[0].message).toBe('WORKSPACE.SOURCES.REMOVED');

        toasts[0].dismissed.next();
        await flush();
        expect(deletePlaylist).toHaveBeenCalledWith(a, {
            onEvent: expect.any(Function),
        });
        expect(dispatch).toHaveBeenCalledWith(
            PlaylistActions.playlistRemovalCommitted({ playlistId: 'a' })
        );
        expect(service.isPending('a')).toBe(false);
    });

    it('restores the source on Undo without deleting anything', async () => {
        service.remove(playlist('a'));
        toasts[0].action.next();
        toasts[0].dismissed.next();
        await flush();
        expect(service.isPending('a')).toBe(false);
        expect(deletePlaylist).not.toHaveBeenCalled();
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

    it('leaves a switch the user made after the delete alone on Undo', () => {
        resolvedPlaylistId.set('a');
        service.remove(playlist('a'), playlist('b'));
        resolvedPlaylistId.set('c');
        toasts[0].action.next();
        expect(context.activatePlaylist).not.toHaveBeenCalled();
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
        toasts[0].dismissed.next();
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
            toasts[0].dismissed.next();
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
        toasts[0].dismissed.next();
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

    it('brings the source back and says so when the delete fails', async () => {
        deletePlaylist.mockResolvedValue(false);
        service.remove(playlist('a'));
        toasts[0].dismissed.next();
        await flush();
        expect(dispatch).not.toHaveBeenCalled();
        expect(service.isPending('a')).toBe(false);
        expect(toasts[1].message).toBe('WORKSPACE.SOURCES.REMOVE_FAILED');
    });
});
