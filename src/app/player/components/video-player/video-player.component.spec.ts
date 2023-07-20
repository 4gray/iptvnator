import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslatePipe } from '@ngx-translate/core';
import { MockComponent, MockModule, MockPipe, MockProviders } from 'ng-mocks';
import { DataService } from '../../../services/data.service';
import { ElectronServiceStub } from '../../../services/electron.service.stub';
import { VideoPlayer } from '../../../settings/settings.interface';
import { ChannelListContainerComponent } from '../channel-list-container/channel-list-container.component';
import { EpgListComponent } from '../epg-list/epg-list.component';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';
import { InfoOverlayComponent } from './../info-overlay/info-overlay.component';
import { VideoPlayerComponent } from './video-player.component';

import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { Observable, of } from 'rxjs';
import { PlaylistsService } from '../../../services/playlists.service';
import { initialState } from '../../../state/state';

class MatSnackBarStub {
    open(): void {}
}

describe('VideoPlayerComponent', () => {
    let component: VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponent>;
    let mockStore: MockStore;
    const actions$ = new Observable<Actions>();

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    MockComponent(EpgListComponent),
                    MockComponent(HtmlVideoPlayerComponent),
                    MockComponent(VjsPlayerComponent),
                    MockComponent(VideoPlayerComponent),
                    MockComponent(ChannelListContainerComponent),
                    MockComponent(InfoOverlayComponent),
                    VideoPlayerComponent,
                    MockPipe(TranslatePipe),
                ],
                providers: [
                    { provide: MatSnackBar, useClass: MatSnackBarStub },
                    { provide: DataService, useClass: ElectronServiceStub },
                    {
                        provide: ActivatedRoute,
                        useValue: {
                            params: of({ id: '1' }),
                            snapshot: {
                                queryParams: {
                                    url: 'https://iptvnator/list.m3u',
                                },
                            },
                        },
                    },
                    provideMockStore(),
                    provideMockActions(actions$),
                    MockProviders(NgxIndexedDBService, PlaylistsService),
                ],
                imports: [
                    MockModule(MatSidenavModule),
                    MockModule(MatIconModule),
                    MockModule(MatToolbarModule),
                    MockModule(MatTooltipModule),
                    MockModule(RouterTestingModule),
                    MockModule(MatDividerModule),
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(VideoPlayerComponent);
        component = fixture.componentInstance;
        mockStore = TestBed.inject(MockStore);

        mockStore.setState({
            playlistState: initialState,
        });
        fixture.detectChanges();
    });

    it('should check default component settings', () => {
        expect(component.playerSettings).toEqual({
            player: VideoPlayer.VideoJs,
            showCaptions: false,
        });
    });
});
