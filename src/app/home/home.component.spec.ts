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
import { Router } from '@angular/router';
import { DialogService } from '../services/dialog.service';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { DataService } from '../services/data.service';

class MatSnackBarStub {
    open(): void {}
}

describe('HomeComponent', () => {
    let component: HomeComponent;
    let dialogService: DialogService;
    let fixture: ComponentFixture<HomeComponent>;
    let electronService: DataService;
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
                { provide: DataService, useClass: ElectronServiceStub },
                MockProvider(DialogService),
                MockProvider(TranslateService),
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);
        dialogService = TestBed.inject(DialogService);
        router = TestBed.inject(Router);
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
        spyOn(electronService, 'sendIpcEvent');
        component.removePlaylist(playlistId);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            'playlist-remove-by-id',
            { id: playlistId }
        );
    });

    it('should send an event to the main process to refresh a playlist', () => {
        const playlistMeta: PlaylistMeta = {
            _id: 'iptv1',
            filePath: '/home/user/lists/iptv.m3u',
        } as PlaylistMeta;
        spyOn(electronService, 'sendIpcEvent');
        component.refreshPlaylist(playlistMeta);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_UPDATE,
            { id: playlistMeta._id, filePath: playlistMeta.filePath }
        );
    });

    it('should send an event to the main process to get a playlist', () => {
        const playlistId = '6789';
        spyOn(electronService, 'sendIpcEvent');
        component.getPlaylist(playlistId);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            'playlist-by-id',
            {
                id: playlistId,
            }
        );
    });

    it('should send an event to the main process to get a playlist by URL', () => {
        const playlistTitle = 'playlist.m3u';
        const playlistUrl = 'http://test.com/' + playlistTitle;
        spyOn(electronService, 'sendIpcEvent');
        component.sendPlaylistsUrl(playlistUrl);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            'parse-playlist-by-url',
            {
                title: playlistTitle,
                url: playlistUrl,
            }
        );
    });

    it('should send an event to the main process to parse a playlist', () => {
        spyOn(electronService, 'sendIpcEvent');
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
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
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
        spyOn(electronService, 'listenOn');
        component.setRendererListeners();
        expect(electronService.listenOn).toHaveBeenCalledTimes(
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
        spyOn(electronService, 'removeAllListeners');
        component.ngOnDestroy();
        expect(electronService.removeAllListeners).toHaveBeenCalledTimes(
            component.commandsList.length
        );
    });
});
