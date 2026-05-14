import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DataService } from 'services';
import { HtmlVideoPlayerComponent } from './html-video-player.component';

describe('HtmlVideoPlayerComponent', () => {
    let component: HtmlVideoPlayerComponent;
    let fixture: ComponentFixture<HtmlVideoPlayerComponent>;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let dataService: DataService;

    const TEST_CHANNEL = {
        id: '1234',
        url: 'http://test.ts',
        name: 'Test channel',
        group: {
            title: 'News group',
        },
        http: {
            'user-agent': 'localhost',
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
        fixture = TestBed.createComponent(HtmlVideoPlayerComponent);
        component = fixture.componentInstance;
        dataService = TestBed.inject(DataService);
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
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

    it('emits a playback issue when the native video element reports an unsupported source', () => {
        const issues: unknown[] = [];
        component.channel = TEST_CHANNEL as never;
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
});
