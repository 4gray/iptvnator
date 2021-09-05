import { InfoOverlayComponent } from './../info-overlay/info-overlay.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
/* eslint-disable @typescript-eslint/unbound-method */
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { VideoPlayerComponent } from './video-player.component';
import { MockComponent, MockModule, MockPipe } from 'ng-mocks';
import { ChannelListContainerComponent } from '../channel-list-container/channel-list-container.component';
import { VjsPlayerComponent } from '../vjs-player/vjs-player.component';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChannelStore } from '../../../state/channel.store';
import * as MOCKED_PLAYLIST from '../../../../mocks/playlist.json';
import { createChannel } from '../../../state';
import { HtmlVideoPlayerComponent } from '../html-video-player/html-video-player.component';
import { EpgListComponent } from '../epg-list/epg-list.component';
import { VideoPlayer } from '../../../settings/settings.interface';

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
                ],
                imports: [
                    MockModule(MatSidenavModule),
                    MockModule(MatIconModule),
                    MockModule(MatToolbarModule),
                    MockModule(MatTooltipModule),
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
        spyOn(component, 'applySettings');
        fixture.detectChanges();
        expect(component.applySettings).toBeCalledTimes(1);
    });

    it('should check default component settings', () => {
        fixture.detectChanges();
        expect(component.playerSettings).toEqual({
            player: VideoPlayer.VideoJs,
            showCaptions: false,
        });
    });

    it('should update store after channel was faved', () => {
        spyOn(store, 'updateFavorite');
        const [firstChannel] = channels;
        component.addToFavorites(firstChannel);
        fixture.detectChanges();
        expect(store.updateFavorite).toBeCalledTimes(1);
        expect(store.updateFavorite).toBeCalledWith(firstChannel);
    });
});
