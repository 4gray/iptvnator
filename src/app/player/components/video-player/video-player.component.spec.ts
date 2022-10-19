import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslatePipe } from '@ngx-translate/core';
import { MockComponent, MockModule, MockPipe } from 'ng-mocks';
import * as MOCKED_PLAYLIST from '../../../../mocks/playlist.json';
import { DataService } from '../../../services/data.service';
import { ElectronServiceStub } from '../../../services/electron.service.stub';
import { VideoPlayer } from '../../../settings/settings.interface';
import { createChannel } from '../../../state';
import { ChannelStore } from '../../../state/channel.store';
import { ChannelListContainerComponent } from '../channel-list-container/channel-list-container.component';
import { EpgListComponent } from '../epg-list/epg-list.component';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';
import { InfoOverlayComponent } from './../info-overlay/info-overlay.component';
import { VideoPlayerComponent } from './video-player.component';

class MatSnackBarStub {
    open(): void {}
}

describe('VideoPlayerComponent', () => {
    let component: VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponent>;
    let store: ChannelStore;
    let channels;

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
                            snapshot: {
                                queryParams: {
                                    url: 'https://iptvnator/list.m3u',
                                },
                            },
                        },
                    },
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
        store = TestBed.inject(ChannelStore);
        // set channels
        channels = MOCKED_PLAYLIST.playlist.items.map((element) =>
            createChannel(element)
        );
        store.upsertMany(channels);
    });

    it('should create and init component', () => {
        expect(component).toBeTruthy();
        jest.spyOn(component, 'applySettings');
        fixture.detectChanges();
        expect(component.applySettings).toHaveBeenCalledTimes(1);
    });

    it('should check default component settings', () => {
        fixture.detectChanges();
        expect(component.playerSettings).toEqual({
            player: VideoPlayer.VideoJs,
            showCaptions: false,
        });
    });

    it('should update store after channel was faved', () => {
        jest.spyOn(store, 'updateFavorite');
        const [firstChannel] = channels;
        component.addToFavorites(firstChannel);
        //fixture.detectChanges();
        expect(store.updateFavorite).toHaveBeenCalledTimes(1);
        expect(store.updateFavorite).toHaveBeenCalledWith(firstChannel);
    });
});
