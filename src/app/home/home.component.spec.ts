import { UploadFile } from 'ngx-uploader';
import {
    PLAYLIST_PARSE,
    PLAYLIST_UPDATE,
} from './../../../shared/ipc-commands';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockComponent, MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { HomeComponent, PlaylistMeta } from './home.component';
import { HeaderComponent } from '../shared/components/header/header.component';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
import { FileUploadComponent } from '../home/file-upload/file-upload.component';
import { UrlUploadComponent } from '../home/url-upload/url-upload.component';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterTestingModule } from '@angular/router/testing';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ElectronService } from '../services/electron.service';
import { Router } from '@angular/router';
import { DialogService } from '../services/dialog.service';
import { ElectronServiceStub } from '../services/electron.service.stub';

class MatSnackBarStub {
    open(): void {}
}

describe('HomeComponent', () => {
    let component: HomeComponent;
    let dialogService: DialogService;
    let fixture: ComponentFixture<HomeComponent>;
    let electronService: ElectronService;
    let router: Router;

    beforeEach(() => {
        TestBed.configureTestingModule({
            declarations: [
                HomeComponent,
                MockComponent(HeaderComponent),
                MockComponent(FileUploadComponent),
                MockComponent(RecentPlaylistsComponent),
                MockComponent(UrlUploadComponent),
                MockPipe(TranslatePipe),
            ],
            imports: [
                MockModule(MatTabsModule),
                MockModule(MatIconModule),
                MockModule(MatProgressBarModule),
                MockModule(MatSnackBarModule),
                MockModule(RouterTestingModule),
            ],
            providers: [
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: ElectronService, useClass: ElectronServiceStub },
                MockProvider(DialogService),
                MockProvider(TranslateService),
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(ElectronService);
        dialogService = TestBed.inject(DialogService);
        router = TestBed.inject(Router);
        TestBed.inject(ElectronService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should open the confirmation dialog on remove icon click', () => {
        const playlistId = '12345';
        spyOn(dialogService, 'openConfirmDialog');
        component.removeClicked(playlistId);
        expect(dialogService.openConfirmDialog).toHaveBeenCalledTimes(1);
    });

    it('should send an event to the main process to remove a playlist', () => {
        const playlistId = '12345';
        spyOn(electronService.ipcRenderer, 'send');
        component.removePlaylist(playlistId);
        expect(electronService.ipcRenderer.send).toHaveBeenCalledWith(
            'playlist-remove-by-id',
            { id: playlistId }
        );
    });

    it('should send an event to the main process to refresh a playlist', () => {
        const playlistMeta: PlaylistMeta = {
            _id: 'iptv1',
            filePath: '/home/user/lists/iptv.m3u',
        } as PlaylistMeta;
        spyOn(electronService.ipcRenderer, 'send');
        component.refreshPlaylist(playlistMeta);
        expect(electronService.ipcRenderer.send).toHaveBeenCalledWith(
            PLAYLIST_UPDATE,
            { id: playlistMeta._id, filePath: playlistMeta.filePath }
        );
    });

    it('should send an event to the main process to get a playlist', () => {
        const playlistId = '6789';
        spyOn(electronService.ipcRenderer, 'send');
        component.getPlaylist(playlistId);
        expect(electronService.ipcRenderer.send).toHaveBeenCalledWith(
            'playlist-by-id',
            {
                id: playlistId,
            }
        );
    });

    it('should send an event to the main process to get a playlist by URL', () => {
        const playlistTitle = 'playlist.m3u';
        const playlistUrl = 'http://test.com/' + playlistTitle;
        spyOn(electronService.ipcRenderer, 'send');
        component.sendPlaylistsUrl(playlistUrl);
        expect(electronService.ipcRenderer.send).toHaveBeenCalledWith(
            'parse-playlist-by-url',
            {
                title: playlistTitle,
                url: playlistUrl,
            }
        );
    });

    it('should send an event to the main process to parse a playlist', () => {
        spyOn(electronService.ipcRenderer, 'send');
        const title = 'my-list.m3u';
        const path = '/home/user/iptv/' + title;
        const playlistContent = 'test';
        const file: UploadFile = {
            nativeFile: { path },
            name: title,
        } as unknown as UploadFile;
        const uploadEvent: Event = {
            target: { result: playlistContent },
        } as unknown as Event;
        component.handlePlaylist({ file, uploadEvent });
        expect(electronService.ipcRenderer.send).toHaveBeenCalledWith(
            PLAYLIST_PARSE,
            { title, playlist: [playlistContent], path }
        );
    });

    it('should return the last last segment from an url', () => {
        expect(component.getLastUrlSegment('http://example.com')).toEqual(
            'example.com'
        );
        expect(
            component.getLastUrlSegment('http://example.com/playlist.m3u')
        ).toEqual('playlist.m3u');
        expect(
            component.getLastUrlSegment('http://example.com/playlist.m3u/')
        ).toEqual('');
    });

    it('should set IPC event listeners', () => {
        spyOn(electronService.ipcRenderer, 'on');
        component.setRendererListeners();
        expect(electronService.ipcRenderer.on).toHaveBeenCalledTimes(
            component.commandsList.length
        );
    });

    it('should send notification on file reject', () => {
        spyOn(component, 'showNotification');
        component.rejectFile('wrong-file.txt');
        expect(component.showNotification).toHaveBeenCalledTimes(1);
    });

    it('should navigate to the player view', () => {
        spyOn(router, 'navigateByUrl');
        component.navigateToPlayer();
        expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            '/iptv',
            expect.anything()
        );
    });

    it('should remove all ipc listeners on destroy', () => {
        spyOn(electronService.ipcRenderer, 'removeAllListeners');
        component.ngOnDestroy();
        expect(
            electronService.ipcRenderer.removeAllListeners
        ).toHaveBeenCalledTimes(component.commandsList.length);
    });
});
