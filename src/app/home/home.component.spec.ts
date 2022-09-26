import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockComponent, MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { NgxIndexedDBModule, NgxIndexedDBService } from 'ngx-indexed-db';
import { of } from 'rxjs';
import { FileUploadComponent } from '../home/file-upload/file-upload.component';
import { RecentPlaylistsComponent } from '../home/recent-playlists/recent-playlists.component';
import { UrlUploadComponent } from '../home/url-upload/url-upload.component';
import { DataService } from '../services/data.service';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { HeaderComponent } from '../shared/components/header/header.component';
import {
    PLAYLIST_PARSE,
    PLAYLIST_PARSE_BY_URL,
} from './../../../shared/ipc-commands';
import { HomeComponent } from './home.component';

class MatSnackBarStub {
    open(): void {}
}

class NgxIndexedDBServiceStub {
    getAll() {
        return of([] as any);
    }
}

describe('HomeComponent', () => {
    let component: HomeComponent;
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
                MockModule(NgxIndexedDBModule),
            ],
            providers: [
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: DataService, useClass: ElectronServiceStub },
                MockProvider(TranslateService),
                {
                    provide: NgxIndexedDBService,
                    useClass: NgxIndexedDBServiceStub,
                },
            ],
        }).compileComponents();
    });

    beforeEach(() => {
        fixture = TestBed.createComponent(HomeComponent);
        component = fixture.componentInstance;
        electronService = TestBed.inject(DataService);

        router = TestBed.inject(Router);
        TestBed.inject(NgxIndexedDBService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should send an event to the main process to get a playlist by URL', () => {
        const playlistTitle = 'playlist.m3u';
        const playlistUrl = 'http://test.com/' + playlistTitle;
        jest.spyOn(electronService, 'sendIpcEvent');
        component.sendPlaylistsUrl(playlistUrl);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            PLAYLIST_PARSE_BY_URL,
            {
                title: playlistTitle,
                url: playlistUrl,
            }
        );
    });

    it('should send an event to the main process to parse a playlist', () => {
        jest.spyOn(electronService, 'sendIpcEvent');
        const title = 'my-list.m3u';
        const path = '/home/user/iptv/' + title;
        const playlistContent = 'test';
        const file: File = {
            path,
            name: title,
        } as unknown as File;
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
        jest.spyOn(electronService, 'listenOn');
        component.setRendererListeners();
        expect(electronService.listenOn).toHaveBeenCalledTimes(
            component.commandsList.length
        );
    });

    it('should send notification on file reject', () => {
        jest.spyOn(component, 'showNotification');
        component.rejectFile('wrong-file.txt');
        expect(component.showNotification).toHaveBeenCalledTimes(1);
    });

    it('should navigate to the player view', () => {
        jest.spyOn(router, 'navigateByUrl');
        component.navigateToPlayer();
        expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
        expect(router.navigateByUrl).toHaveBeenCalledWith(
            '/iptv',
            expect.anything()
        );
    });

    it('should remove all ipc listeners on destroy', () => {
        jest.spyOn(electronService, 'removeAllListeners');
        component.ngOnDestroy();
        expect(electronService.removeAllListeners).toHaveBeenCalledTimes(
            component.commandsList.length
        );
    });
});
