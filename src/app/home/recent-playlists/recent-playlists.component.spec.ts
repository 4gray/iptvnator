import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { Observable } from 'rxjs';
import { PLAYLIST_UPDATE } from '../../../../shared/ipc-commands';
import { DataService } from '../../services/data.service';
import { DialogService } from '../../services/dialog.service';
import { ElectronServiceStub } from '../../services/electron.service.stub';
import { PlaylistMeta } from '../../shared/playlist-meta.type';
import { initialPlaylistMetaState } from '../../state/playlists.state';
import { RecentPlaylistsComponent } from './recent-playlists.component';

describe('RecentPlaylistsComponent', () => {
    let component: RecentPlaylistsComponent;
    let fixture: ComponentFixture<RecentPlaylistsComponent>;
    let electronService: DataService;
    let dialog: MatDialog;
    let dialogService: DialogService;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            declarations: [RecentPlaylistsComponent, MockPipe(TranslatePipe)],
            imports: [
                MockModule(MatDialogModule),
                MockModule(MatListModule),
                MockModule(MatIconModule),
                MockModule(MatTooltipModule),
                MockModule(NgxSkeletonLoaderModule),
            ],
            providers: [
                { provide: DataService, useClass: ElectronServiceStub },
                MockProvider(TranslateService),
                MockProvider(DialogService),
                MatSnackBar,
                provideMockStore(),
                provideMockActions(actions$),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(RecentPlaylistsComponent);
        component = fixture.componentInstance;
        dialog = TestBed.inject(MatDialog);
        electronService = TestBed.inject(DataService);
        dialogService = TestBed.inject(DialogService);
        mockStore = TestBed.inject(MockStore);
        mockStore.setState({
            playlistState: { playlists: initialPlaylistMetaState },
        });
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should open the info dialog', () => {
        jest.spyOn(dialog, 'open');
        component.openInfoDialog({} as PlaylistMeta);
        expect(dialog.open).toHaveBeenCalledTimes(1);
    });

    it('should send an ipc event after drop event', () => {
        const event = {
            previousIndex: 0,
            currentIndex: 1,
            item: undefined,
            container: undefined,
            previousContainer: undefined,
            isPointerOverContainer: true,
            distance: { x: 0, y: 0 },
            dropPoint: { x: 0, y: 0 },
        } as any;
        jest.spyOn(mockStore, 'dispatch');
        component.drop(event, []);
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });

    it('should open the confirmation dialog on remove icon click', () => {
        const playlistId = '12345';
        jest.spyOn(dialogService, 'openConfirmDialog');
        component.removeClicked(playlistId);
        expect(dialogService.openConfirmDialog).toHaveBeenCalledTimes(1);
    });

    it('should send an event to the main process to remove a playlist', () => {
        const playlistId = '12345';
        jest.spyOn(mockStore, 'dispatch');
        component.removePlaylist(playlistId);
        expect(mockStore.dispatch).toHaveBeenCalledTimes(1);
    });

    it('should send an event to the main process to refresh a playlist', () => {
        const playlistMeta: PlaylistMeta = {
            id: 'iptv1',
            title: 'iptv',
            filePath: '/home/user/lists/iptv.m3u',
        } as unknown as PlaylistMeta;
        jest.spyOn(electronService, 'sendIpcEvent');
        component.refreshPlaylist(playlistMeta);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_UPDATE,
            {
                id: playlistMeta._id,
                filePath: playlistMeta.filePath,
                title: playlistMeta.title,
            }
        );
    });

    it('should send an event to the main process to get a playlist', () => {
        const playlistId = '6789';
        jest.spyOn(component.playlistClicked, 'emit');
        component.getPlaylist({ _id: playlistId } as unknown as PlaylistMeta);
        expect(component.playlistClicked.emit).toHaveBeenCalledTimes(1);
    });
});
