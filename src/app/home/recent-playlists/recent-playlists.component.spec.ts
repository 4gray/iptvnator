import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockModule, MockPipe, MockProvider } from 'ng-mocks';
import {
    PLAYLIST_GET_BY_ID,
    PLAYLIST_REMOVE_BY_ID,
    PLAYLIST_UPDATE,
} from '../../../../shared/ipc-commands';
import { DataService } from '../../services/data.service';
import { DialogService } from '../../services/dialog.service';
import { ElectronServiceStub } from '../../services/electron.service.stub';
import { PlaylistMeta } from '../../shared/playlist-meta.type';
import { RecentPlaylistsComponent } from './recent-playlists.component';

describe('RecentPlaylistsComponent', () => {
    let component: RecentPlaylistsComponent;
    let fixture: ComponentFixture<RecentPlaylistsComponent>;
    let electronService: DataService;
    let dialog: MatDialog;
    let dialogService: DialogService;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    RecentPlaylistsComponent,
                    MockPipe(TranslatePipe),
                ],
                imports: [
                    MockModule(MatDialogModule),
                    MockModule(MatListModule),
                    MockModule(MatIconModule),
                    MockModule(MatTooltipModule),
                ],
                providers: [
                    { provide: DataService, useClass: ElectronServiceStub },
                    MockProvider(TranslateService),
                    MockProvider(DialogService),
                    MatSnackBar,
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(RecentPlaylistsComponent);
        component = fixture.componentInstance;
        component.playlists = [];
        dialog = TestBed.inject(MatDialog);
        electronService = TestBed.inject(DataService);
        dialogService = TestBed.inject(DialogService);
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
        jest.spyOn(electronService, 'sendIpcEvent');
        component.drop(event);
        expect(electronService.sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('should open the confirmation dialog on remove icon click', () => {
        const playlistId = '12345';
        jest.spyOn(dialogService, 'openConfirmDialog');
        component.removeClicked(playlistId);
        expect(dialogService.openConfirmDialog).toHaveBeenCalledTimes(1);
    });

    it('should send an event to the main process to remove a playlist', () => {
        const playlistId = '12345';
        jest.spyOn(electronService, 'sendIpcEvent');
        component.removePlaylist(playlistId);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_REMOVE_BY_ID,
            { id: playlistId }
        );
    });

    it('should send an event to the main process to refresh a playlist', () => {
        const playlistMeta: PlaylistMeta = {
            _id: 'iptv1',
            filePath: '/home/user/lists/iptv.m3u',
        } as PlaylistMeta;
        jest.spyOn(electronService, 'sendIpcEvent');
        component.refreshPlaylist(playlistMeta);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_UPDATE,
            { id: playlistMeta._id, filePath: playlistMeta.filePath }
        );
    });

    it('should send an event to the main process to get a playlist', () => {
        const playlistId = '6789';
        jest.spyOn(electronService, 'sendIpcEvent');
        component.getPlaylist(playlistId);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_GET_BY_ID,
            {
                id: playlistId,
            }
        );
    });
});
