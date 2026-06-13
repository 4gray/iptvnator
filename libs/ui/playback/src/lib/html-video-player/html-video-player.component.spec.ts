import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

describe('HtmlVideoPlayerComponent', () => {
    let component: HtmlVideoPlayerComponent;
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;
    const electronApi = {
        setUserAgent: jest.fn().mockResolvedValue(true),
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let dataService: DataService;

    const TEST_CHANNEL: Channel = {
        id: '1234',
        url: 'http://test.ts',
        name: 'Test channel',
        group: {
            title: 'News group',
        },
        http: {
            origin: '',
            referrer: '',
            'user-agent': 'localhost',
        },
        radio: 'false',
        tvg: {
            id: '',
            logo: '',
            name: '',
            rec: '',
            url: '',
        },
    };

    beforeEach(waitForAsync(() => {
        const dataServiceMock = {
            sendIpcEvent: jest.fn().mockResolvedValue(undefined),
        };

        TestBed.configureTestingModule({
            imports: [HtmlVideoPlayerComponent, TranslateModule.forRoot()],
            providers: [{ provide: DataService, useValue: dataServiceMock }],
        }).compileComponents();
    }));

    beforeEach(() => {
        Object.defineProperty(window, 'electron', {
            configurable: true,
            value: electronApi,
        });
        electronApi.setUserAgent.mockClear();
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        component = fixture.componentInstance;
        dataService = TestBed.inject(DataService);
        fixture.detectChanges();
    });

    afterEach(() => {
        delete (window as unknown as { electron?: unknown }).electron;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('detaches volume/metadata/timeupdate listeners on destroy (no leak)', () => {
        const el = component.videoPlayer.nativeElement;
        const removeSpy = jest.spyOn(el, 'removeEventListener');
        const handlers = component as unknown as {
            handleVolumeChange: EventListener;
            handleLoadedMetadata: EventListener;
            handleTimeUpdate: EventListener;
        };

        fixture.destroy();

        expect(removeSpy).toHaveBeenCalledWith(
            'volumechange',
            handlers.handleVolumeChange
        );
        expect(removeSpy).toHaveBeenCalledWith(
            'loadedmetadata',
            handlers.handleLoadedMetadata
        );
        expect(removeSpy).toHaveBeenCalledWith(
            'timeupdate',
            handlers.handleTimeUpdate
        );
    });

    it('should call play channel function after input changes', () => {
        jest.spyOn(component, 'playChannel');
        jest.spyOn(global.console, 'error').mockImplementation(() => {
            /* empty */
        });
        component.ngOnChanges({
            channel: new SimpleChange(null, TEST_CHANNEL, true),
        });
        fixture.detectChanges();

        expect(component.playChannel).toHaveBeenCalledWith(TEST_CHANNEL);
    });

    it('passes channel headers and stream URL to Electron header overrides', () => {
        jest.spyOn(
            component.videoPlayer.nativeElement,
            'load'
        ).mockImplementation(() => undefined);
        jest.spyOn(
            component.videoPlayer.nativeElement,
            'play'
        ).mockResolvedValue(undefined);

        component.playChannel({
            ...TEST_CHANNEL,
            http: {
                'user-agent': 'ChannelAgent/1.0',
                origin: '',
                referrer: 'https://portal.example/referrer',
            },
            radio: 'false',
            url: 'https://stream.example/video.mp4',
        });

        expect(electronApi.setUserAgent).toHaveBeenCalledWith(
            'ChannelAgent/1.0',
            'https://portal.example/referrer',
            'https://stream.example/video.mp4'
        );
    });

    it('clears Electron header overrides for channels without custom headers', () => {
        jest.spyOn(
            component.videoPlayer.nativeElement,
            'load'
        ).mockImplementation(() => undefined);
        jest.spyOn(
            component.videoPlayer.nativeElement,
            'play'
        ).mockResolvedValue(undefined);

        component.playChannel({
            ...TEST_CHANNEL,
            http: {
                'user-agent': '',
                origin: '',
                referrer: '',
            },
            radio: 'false',
            url: 'https://stream.example/video.mp4',
        });

        expect(electronApi.setUserAgent).toHaveBeenCalledWith(
            '',
            '',
            'https://stream.example/video.mp4'
        );
    });

    it('replaces and reloads native video sources when switching episodes', () => {
        const video = component.videoPlayer.nativeElement;
        const loadSpy = jest
            .spyOn(video, 'load')
            .mockImplementation(() => undefined);
        const playSpy = jest.spyOn(video, 'play').mockResolvedValue(undefined);

        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://stream.example/series/s01e01.mp4',
        });
        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://stream.example/series/s01e02.mp4',
        });

        const sources = Array.from(video.querySelectorAll('source'));
        const [source] = sources;
        expect(sources).toHaveLength(1);
        expect(source?.src).toBe(
            'https://stream.example/series/s01e02.mp4'
        );
        expect(source?.type).toBe('video/mp4');
        expect(loadSpy).toHaveBeenCalledTimes(2);
        expect(playSpy).toHaveBeenCalledTimes(2);
        expect(loadSpy.mock.invocationCallOrder[1]).toBeLessThan(
            playSpy.mock.invocationCallOrder[1]
        );
    });

    it('emits a playback issue when the native video element reports an unsupported source', () => {
        const issues: unknown[] = [];
        component.channel = TEST_CHANNEL;
        component.playbackIssue.subscribe((issue) => issues.push(issue));

        Object.defineProperty(component.videoPlayer.nativeElement, 'error', {
            configurable: true,
            value: {
                code: 4,
                message: 'No compatible source was found',
            },
        });

        component.videoPlayer.nativeElement.dispatchEvent(new Event('error'));

        expect(issues).toEqual([
            expect.objectContaining({
                code: 'unsupported-container',
                source: 'native',
                sourceUrl: 'http://test.ts',
                externalFallbackRecommended: true,
            }),
        ]);
    });

    it('does not emit a playback issue when HLS.js reports a recoverable error', () => {
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });

        (
            component as unknown as {
                handleHlsError: (
                    url: string,
                    data: {
                        type: string;
                        details: string;
                        fatal: boolean;
                        error?: Error;
                    }
                ) => void;
            }
        ).handleHlsError('https://example.com/live/playlist.m3u8', {
            type: 'networkError',
            details: 'fragLoadError',
            fatal: false,
            error: new Error('segment retry'),
        });

        expect(issues).toEqual([]);
    });

    it('keeps raw HLS error object context in emitted playback issue details', () => {
        const issues: Array<{ details?: string }> = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });

        (
            component as unknown as {
                handleHlsError: (
                    url: string,
                    data: {
                        type: string;
                        details: string;
                        fatal: boolean;
                        error?: unknown;
                    }
                ) => void;
            }
        ).handleHlsError('https://example.com/live/playlist.m3u8', {
            type: 'networkError',
            details: 'manifestLoadError',
            fatal: true,
            error: {
                context: 'xhr setup failed',
                status: 0,
            },
        });

        expect(issues[0].details).toContain('xhr setup failed');
        expect(issues[0].details).toContain('"status":0');
    });

    it('emits playbackEnded exactly once for a native ended event and not during reload or destroy', () => {
        const events: string[] = [];
        (
            component as unknown as {
                playbackEnded: {
                    subscribe: (fn: () => void) => { unsubscribe: () => void };
                };
            }
        ).playbackEnded.subscribe(() => events.push('ended'));
        jest.spyOn(
            component.videoPlayer.nativeElement,
            'load'
        ).mockImplementation(() => undefined);
        jest.spyOn(
            component.videoPlayer.nativeElement,
            'play'
        ).mockResolvedValue(undefined);

        component.videoPlayer.nativeElement.dispatchEvent(new Event('ended'));
        component.playChannel({
            ...TEST_CHANNEL,
            url: 'https://stream.example/series/s01e03.mp4',
        });
        fixture.destroy();

        expect(events).toEqual(['ended']);
    });

    it('hides series navigation controls when series navigation is absent', () => {
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="series-playback-previous-episode"]')
            )
        ).toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('[data-test-id="series-playback-next-episode"]')
            )
        ).toBeNull();
    });

    it('renders series navigation controls with boundary disabled state', () => {
        const events: string[] = [];
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: true,
            canNext: false,
            autoplayEnabled: true,
        });
        (
            component as unknown as {
                previousEpisodeRequested: {
                    subscribe: (fn: () => void) => { unsubscribe: () => void };
                };
                nextEpisodeRequested: {
                    subscribe: (fn: () => void) => { unsubscribe: () => void };
                };
            }
        ).previousEpisodeRequested.subscribe(() => events.push('previous'));
        (
            component as unknown as {
                nextEpisodeRequested: {
                    subscribe: (fn: () => void) => { unsubscribe: () => void };
                };
            }
        ).nextEpisodeRequested.subscribe(() => events.push('next'));

        fixture.detectChanges();

        const previousButton = fixture.debugElement.query(
            By.css('[data-test-id="series-playback-previous-episode"]')
        );
        const nextButton = fixture.debugElement.query(
            By.css('[data-test-id="series-playback-next-episode"]')
        );
        expect(previousButton).not.toBeNull();
        expect(previousButton.nativeElement.disabled).toBe(false);
        expect(nextButton).not.toBeNull();
        expect(nextButton.nativeElement.disabled).toBe(true);

        previousButton.nativeElement.click();
        nextButton.nativeElement.click();

        expect(events).toEqual(['previous']);
    });
});
