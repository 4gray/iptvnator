import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

/** DASH-specific behavior of the HTML5 player (legacy controls mode). */
describe('HtmlVideoPlayerComponent DASH', () => {
    let component: HtmlVideoPlayerComponent;
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;
    const electronApi = {
        setUserAgent: jest.fn().mockResolvedValue(true),
    };

    const TEST_CHANNEL: Channel = {
        id: 'dash-1',
        url: 'https://stream.example/enc.mpd',
        name: 'DASH channel',
        group: { title: 'DASH' },
        http: { origin: '', referrer: '', 'user-agent': '' },
        radio: 'false',
        tvg: { id: '', logo: '', name: '', rec: '', url: '' },
    };

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [HtmlVideoPlayerComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: DataService,
                    useValue: {
                        sendIpcEvent: jest.fn().mockResolvedValue(undefined),
                    },
                },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electronApi,
        });
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
        jest.restoreAllMocks();
    });

    it('does not resume the previous source when a channel declares unsupported DRM', () => {
        const video = component.videoPlayer.nativeElement;
        const loadSpy = jest
            .spyOn(video, 'load')
            .mockImplementation(() => undefined);
        const playSpy = jest.spyOn(video, 'play').mockResolvedValue(undefined);

        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://stream.example/movie.mp4',
        });
        playSpy.mockClear();
        loadSpy.mockClear();

        component.playChannel({
            ...TEST_CHANNEL,
            drm: {
                licenseType: 'com.widevine.alpha',
                supported: false,
            },
        });

        // No source is loaded for unsupported DRM: play() must not run, and
        // the element is reset so the old stream cannot keep playing.
        expect(playSpy).not.toHaveBeenCalled();
        expect(loadSpy).toHaveBeenCalledTimes(1);
    });
});
