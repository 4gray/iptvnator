/* eslint-disable @typescript-eslint/unbound-method */
import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoPlayerComponent } from './video-player.component';
import { MockComponent, MockModule } from 'ng-mocks';
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

class MatSnackBarStub {
    open(): void {}
}

describe('VideoPlayerComponent', () => {
    let component: VideoPlayerComponent;
    let fixture: ComponentFixture<VideoPlayerComponent>;
    let store: ChannelStore;
    let channels;

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [
                MockComponent(HtmlVideoPlayerComponent),
                MockComponent(VjsPlayerComponent),
                MockComponent(VideoPlayerComponent),
                MockComponent(ChannelListContainerComponent),
                VideoPlayerComponent,
            ],
            providers: [{ provide: MatSnackBar, useClass: MatSnackBarStub }],
            imports: [
                MockModule(MatSidenavModule),
                MockModule(MatIconModule),
                MockModule(MatToolbarModule),
            ],
        }).compileComponents();
    }));

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
        expect(component.player).toEqual('html5');
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
