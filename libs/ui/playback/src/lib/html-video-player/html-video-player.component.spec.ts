import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    ErrorDetails,
    ErrorTypes,
    type ErrorData,
    type ManifestParsedData,
} from 'hls.js';
import {
    PlayerControlsComponent,
    WEB_PLAYER_SHARED_CONTROLS,
    WebVideoControlsAdapter,
} from '../player-controls';
import { SeriesPlaybackNavigationControlsComponent } from '../portal-inline-player/series-playback-navigation-controls.component';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

describe('HtmlVideoPlayerComponent', () => {
    let component: HtmlVideoPlayerComponent;
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;
    let adapterAttach: jest.SpiedFunction<WebVideoControlsAdapter['attach']>;
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
            // This suite covers the legacy vendor-chrome path, which is an
            // explicit opt-out now that shared controls default on.
            providers: [
                { provide: DataService, useValue: dataServiceMock },
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: false },
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        adapterAttach = jest.spyOn(WebVideoControlsAdapter.prototype, 'attach');
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
        jest.restoreAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('keeps native and legacy controls when shared controls are disabled', () => {
        const video = component.videoPlayer.nativeElement;

        expect(video.controls).toBe(true);
        expect(
            fixture.debugElement.query(By.directive(PlayerControlsComponent))
        ).toBeNull();
        expect(
            fixture.debugElement.query(
                By.directive(SeriesPlaybackNavigationControlsComponent)
            )
        ).not.toBeNull();
        expect(adapterAttach).not.toHaveBeenCalled();
    });

    it('drives playback keyboard shortcuts against the native video element', () => {
        const video = component.videoPlayer.nativeElement;
        expect(video.muted).toBe(false);

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'm',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(video.muted).toBe(true);

        fixture.destroy();
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'm',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(video.muted).toBe(true);
    });

    it('detaches volume/metadata/timeupdate listeners on destroy (no leak)', () => {
        const el = component.videoPlayer.nativeElement;
        const removeSpy = jest.spyOn(el, 'removeEventListener');
        fixture.destroy();

        expect(removeSpy).toHaveBeenCalledWith(
            'volumechange',
            expect.any(Function)
        );
        expect(removeSpy).toHaveBeenCalledWith(
            'loadedmetadata',
            expect.any(Function)
        );
        expect(removeSpy).toHaveBeenCalledWith(
            'timeupdate',
            expect.any(Function)
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

    it('does not configure Electron header overrides itself — WebPlayerViewComponent owns them', () => {
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

        // A second three-header call from here would overwrite the richer
        // scoped override (incl. Cookie/Authorization) the host configured.
        expect(electronApi.setUserAgent).not.toHaveBeenCalled();
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
        expect(source?.src).toBe('https://stream.example/series/s01e02.mp4');
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
            }),
        ]);
    });

    it('uses browser media-type support for HLS manifest codec diagnostics', () => {
        const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'MediaSource'
        );
        Object.defineProperty(globalThis, 'MediaSource', {
            configurable: true,
            value: { isTypeSupported: jest.fn(() => false) },
        });
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => issues.push(issue));

        try {
            (
                component as unknown as {
                    handleHlsManifestParsed: (
                        url: string,
                        data: ManifestParsedData
                    ) => void;
                }
            ).handleHlsManifestParsed(
                'https://example.com/live/playlist.m3u8',
                {
                    levels: [{ audioCodec: 'ac-3', videoCodec: 'avc1.64001f' }],
                } as ManifestParsedData
            );
        } finally {
            restoreMediaSource(mediaSourceDescriptor);
        }
        expect(issues).toEqual([
            expect.objectContaining({
                code: 'unsupported-codec',
                source: 'source',
            }),
        ]);
    });

    it('keeps HLS manifest handling alive when the browser support probe throws', () => {
        const mediaSourceDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'MediaSource'
        );
        Object.defineProperty(globalThis, 'MediaSource', {
            configurable: true,
            value: {
                isTypeSupported: () => {
                    throw new Error('provider-controlled-codec');
                },
            },
        });
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => issues.push(issue));

        try {
            expect(() =>
                (
                    component as unknown as {
                        handleHlsManifestParsed: (
                            url: string,
                            data: ManifestParsedData
                        ) => void;
                    }
                ).handleHlsManifestParsed(
                    'https://example.com/live/playlist.m3u8',
                    {
                        levels: [
                            {
                                audioCodec: 'provider-controlled-codec',
                                videoCodec: 'avc1.64001f',
                            },
                        ],
                    } as ManifestParsedData
                )
            ).not.toThrow();
        } finally {
            restoreMediaSource(mediaSourceDescriptor);
        }
        expect(issues).toEqual([]);
    });

    it('does not emit a playback issue when HLS.js reports a recoverable error', () => {
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });

        (
            component as unknown as {
                handleHlsError: (url: string, data: ErrorData) => void;
            }
        ).handleHlsError('https://example.com/live/playlist.m3u8', {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.FRAG_LOAD_ERROR,
            fatal: false,
            error: new Error('segment retry'),
        });

        expect(issues).toEqual([]);
    });

    it('emits only structured HLS evidence for a fatal manifest HTTP failure', () => {
        const issues: Array<{
            readonly code?: string;
            readonly httpStatus?: number;
            readonly hls?: unknown;
        }> = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });
        const secret = 'html-hls-secret-sentinel';

        (
            component as unknown as {
                handleHlsError: (url: string, data: ErrorData) => void;
            }
        ).handleHlsError('https://example.com/live/playlist.m3u8', {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.MANIFEST_LOAD_ERROR,
            fatal: true,
            error: new Error(`provider message ${secret}`),
            reason: `provider reason ${secret}`,
            response: {
                code: 404,
                url: `https://provider.example/error?token=${secret}`,
                text: secret,
                data: { body: secret },
            },
            networkDetails: { responseText: secret },
        });

        expect(issues[0]).toEqual(
            expect.objectContaining({
                code: 'network-error',
                httpStatus: 404,
                hls: {
                    engineType: ErrorTypes.NETWORK_ERROR,
                    engineDetails: ErrorDetails.MANIFEST_LOAD_ERROR,
                    disposition: 'fatal',
                    stage: 'manifest',
                    failure: 'http',
                    httpStatus: 404,
                },
            })
        );
        expect(JSON.stringify(issues[0].hls)).not.toContain(secret);
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

function restoreMediaSource(descriptor?: PropertyDescriptor): void {
    if (descriptor) {
        Object.defineProperty(globalThis, 'MediaSource', descriptor);
        return;
    }
    Reflect.deleteProperty(globalThis, 'MediaSource');
}
