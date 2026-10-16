import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    DatabaseService,
    PlaylistsService,
    RuntimeCapabilitiesService,
    SourceActivityService,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { ConfirmDialogData, DialogService } from '@iptvnator/ui/components';
import { PlaylistErrorViewComponent } from './playlist-error-view.component';

const XTREAM_PLAYLIST = {
    _id: 'xtream-1',
    title: 'Portal',
    serverUrl: 'http://portal.test',
    username: 'user',
    password: 'pass',
    importDate: '2026-09-30T10:00:00.000Z',
} as PlaylistMeta;

describe('PlaylistErrorViewComponent removal', () => {
    let activity: SourceActivityService;
    let busyDuringDelete: boolean[];
    let deleteResult: Observable<{ success: boolean }>;
    let playlistsService: { deletePlaylist: jest.Mock };
    let dialogService: { openConfirmDialog: jest.Mock };
    let store: { dispatch: jest.Mock };
    let snackBar: { open: jest.Mock };
    let navigate: jest.SpyInstance;

    function setup(): PlaylistErrorViewComponent {
        busyDuringDelete = [];
        deleteResult = of({ success: true });
        playlistsService = {
            deletePlaylist: jest.fn((id: string) => {
                busyDuringDelete.push(activity.isBusy(id));
                return deleteResult;
            }),
        };
        dialogService = { openConfirmDialog: jest.fn() };
        store = { dispatch: jest.fn() };
        snackBar = { open: jest.fn() };

        TestBed.configureTestingModule({
            imports: [PlaylistErrorViewComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: PlaylistContextFacade,
                    useValue: { activePlaylist: signal(XTREAM_PLAYLIST) },
                },
                { provide: PlaylistsService, useValue: playlistsService },
                {
                    provide: DatabaseService,
                    useValue: { createOperationId: () => 'op-1' },
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsXtreamSqliteDataSource: true },
                },
                { provide: DialogService, useValue: dialogService },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                { provide: MatSnackBar, useValue: snackBar },
                { provide: Store, useValue: store },
                provideRouter([]),
            ],
        });
        activity = TestBed.inject(SourceActivityService);
        navigate = jest
            .spyOn(TestBed.inject(Router), 'navigate')
            .mockResolvedValue(true);
        return TestBed.createComponent(PlaylistErrorViewComponent)
            .componentInstance;
    }

    function confirmRemoval(component: PlaylistErrorViewComponent) {
        component.removeClicked();
        const data = dialogService.openConfirmDialog.mock
            .calls[0][0] as ConfirmDialogData;
        data.onConfirm();
        return data;
    }

    it('asks with a named destructive action', () => {
        const component = setup();
        component.removeClicked();

        expect(dialogService.openConfirmDialog).toHaveBeenCalledWith(
            expect.objectContaining({
                confirmLabel: 'HOME.PLAYLISTS.REMOVE',
                tone: 'destructive',
            })
        );
    });

    it('removes through the shared delete action: busy source, Xtream cache, commit, toast', async () => {
        const component = setup();
        confirmRemoval(component);

        await new Promise((resolve) => setTimeout(resolve));

        // The worker delete (with an operation id) drops the Xtream cache.
        expect(playlistsService.deletePlaylist).toHaveBeenCalledWith(
            'xtream-1',
            expect.objectContaining({ operationId: 'op-1' })
        );
        // The source is marked busy while it is deleted, then released.
        expect(busyDuringDelete).toEqual([true]);
        expect(activity.isBusy('xtream-1')).toBe(false);
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.playlistRemovalCommitted({
                playlistId: 'xtream-1',
            })
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS',
            undefined,
            { duration: 2000 }
        );
        expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('keeps the playlist and stays put when the delete fails', async () => {
        const component = setup();
        deleteResult = new Observable((subscriber) =>
            subscriber.error(new Error('worker failed'))
        );

        await component.removePlaylist(XTREAM_PLAYLIST);

        expect(store.dispatch).not.toHaveBeenCalled();
        expect(snackBar.open).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        expect(activity.isBusy('xtream-1')).toBe(false);
    });

    it('does not start a second removal while the source is busy', async () => {
        const component = setup();
        const release = activity.begin(['xtream-1']);

        component.removeClicked();
        await component.removePlaylist(XTREAM_PLAYLIST);

        expect(dialogService.openConfirmDialog).not.toHaveBeenCalled();
        expect(playlistsService.deletePlaylist).not.toHaveBeenCalled();
        release();
    });
});
