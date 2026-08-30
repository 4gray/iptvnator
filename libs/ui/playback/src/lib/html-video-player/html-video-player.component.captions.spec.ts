import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
import {
    createTextTrack,
    FakeTextTrackList,
} from './html-video-player-controls.spec-fixtures';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

/** `.mp4` skips the hls.js/mpegts.js branches and binds the native source. */
const NATIVE_SOURCE_URL = 'http://test.example/stream.mp4';
const OTHER_SOURCE_URL = 'http://test.example/next.mp4';

const TEST_CHANNEL: Channel = {
    id: '1234',
    url: NATIVE_SOURCE_URL,
    name: 'Test channel',
    group: { title: 'News group' },
    http: { origin: '', referrer: '', 'user-agent': 'localhost' },
    radio: 'false',
    tvg: { id: '', logo: '', name: '', rec: '', url: '' },
};

/**
 * Regression coverage for #1155: without shared controls (the shipping
 * default) the `showCaptions` preference had no owner at all, so a track the
 * source engine enabled by default kept subtitles on screen.
 */
describe('HtmlVideoPlayerComponent caption preference without shared controls', () => {
    let component: HtmlVideoPlayerComponent;
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;

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
                // "without shared controls" — pin the opt-out explicitly now
                // that shared controls default on.
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: false },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: { setUserAgent: jest.fn().mockResolvedValue(true) },
        });
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
        jest.restoreAllMocks();
    });

    it('suppresses initial and late default captions when the preference is off', () => {
        const initial = createTextTrack({ kind: 'captions', mode: 'showing' });
        const textTracks = stubTextTracks([initial]);
        setPreference(false);

        component.playChannel(TEST_CHANNEL);

        expect(initial.mode).toBe('hidden');

        const late = createTextTrack({ kind: 'subtitles', mode: 'showing' });
        textTracks.add(late);

        expect(late.mode).toBe('hidden');
    });

    it('leaves captions alone when the preference is on', () => {
        const track = createTextTrack({ kind: 'captions', mode: 'showing' });
        stubTextTracks([track]);
        setPreference(true);

        component.playChannel(TEST_CHANNEL);

        expect(track.mode).toBe('showing');
    });

    // The native controls stay visible in this mode, so the preference must
    // seed the source and then get out of the user's way.
    it('keeps a caption the user enables after playback started', () => {
        const track = createTextTrack({ kind: 'captions', mode: 'showing' });
        const textTracks = stubTextTracks([track]);
        setPreference(false);
        component.playChannel(TEST_CHANNEL);
        expect(track.mode).toBe('hidden');

        component.videoPlayer.nativeElement.dispatchEvent(
            new Event('playing')
        );
        track.mode = 'showing';
        textTracks.emit('change');

        expect(track.mode).toBe('showing');
    });

    it('re-seeds the preference for the next channel', () => {
        const first = createTextTrack({ kind: 'captions', mode: 'showing' });
        const textTracks = stubTextTracks([first]);
        setPreference(false);
        component.playChannel(TEST_CHANNEL);
        component.videoPlayer.nativeElement.dispatchEvent(
            new Event('playing')
        );

        const next = createTextTrack({ kind: 'captions', mode: 'showing' });
        textTracks.replaceSilently([next]);
        component.playChannel({ ...TEST_CHANNEL, url: OTHER_SOURCE_URL });

        expect(next.mode).toBe('hidden');
    });

    it('restores suppressed captions when the preference is turned on', () => {
        const track = createTextTrack({ kind: 'captions', mode: 'showing' });
        stubTextTracks([track]);
        setPreference(false);
        component.playChannel(TEST_CHANNEL);
        expect(track.mode).toBe('hidden');

        setPreference(true);

        expect(track.mode).toBe('showing');
    });

    function setPreference(showCaptions: boolean): void {
        fixture.componentRef.setInput('showCaptions', showCaptions);
        fixture.detectChanges();
    }

    function stubTextTracks(tracks: TextTrack[]): FakeTextTrackList {
        const video = component.videoPlayer.nativeElement;
        const textTracks = new FakeTextTrackList(tracks);
        Object.defineProperty(video, 'textTracks', {
            configurable: true,
            value: textTracks.asTextTrackList(),
        });
        jest.spyOn(video, 'play').mockResolvedValue(undefined);
        jest.spyOn(video, 'load').mockImplementation(() => undefined);
        return textTracks;
    }
});
