import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { NativePlaybackErrorInput } from '@iptvnator/playback/util';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls/web-player-controls.flag';
import type { VjsPlayerComponent as VjsPlayerComponentInstance } from './vjs-player.component';
import type { VideoJsPlayer } from './vjs-player.types';

const videoJsMock = jest.fn();
const mpegTsIsSupportedMock = jest.fn(() => false);

jest.unstable_mockModule('video.js', () => ({
    default: videoJsMock,
}));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));
jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: jest.fn(),
        isSupported: mpegTsIsSupportedMock,
    },
}));

describe('VjsPlayerComponent', () => {
    let VjsPlayerComponent: typeof import('./vjs-player.component').VjsPlayerComponent;
    let fixture: ComponentFixture<VjsPlayerComponentInstance>;
    let component: VjsPlayerComponentInstance;
    let harness: ReturnType<typeof createPlayerHarness>;

    beforeAll(async () => {
        ({ VjsPlayerComponent } = await import('./vjs-player.component'));
    });

    beforeEach(async () => {
        harness = createPlayerHarness();
        videoJsMock
            .mockReset()
            .mockImplementation(
                (_target: Element, _options: unknown, ready: () => void) => {
                    harness.ready = ready;
                    return harness.player;
                }
            );
        mpegTsIsSupportedMock.mockReset().mockReturnValue(false);
        await TestBed.configureTestingModule({
            imports: [VjsPlayerComponent],
            // This suite covers the legacy vendor-chrome path, which is an
            // explicit opt-out now that shared controls default on.
            providers: [
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: false },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(VjsPlayerComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        if (!fixture.componentRef.hostView.destroyed) {
            fixture.destroy();
        }
        localStorage.removeItem('volume');
    });

    it('uses signal-based inputs and outputs', () => {
        expect(typeof component.options).toBe('function');
        expect(component.volume()).toBe(1);
        expect(component.startTime()).toBe(0);
        expect(component.interactionEnabled()).toBe(true);
        expect(component.showCaptions()).toBe(false);
        expect(typeof component.timeUpdate.emit).toBe('function');
        expect(typeof component.playbackIssue.emit).toBe('function');
    });

    it('preserves legacy Video.js options and controls while the flag is off', () => {
        render({
            sources: [{ src: 'https://example.test/movie.mp4' }],
            userActions: { hotkeys: true },
            spatialNavigation: { enabled: true },
        });

        expect(videoJsMock).toHaveBeenCalledWith(
            expect.any(Element),
            expect.objectContaining({
                autoplay: true,
                controls: true,
                userActions: { hotkeys: true },
                spatialNavigation: { enabled: true },
            }),
            expect.any(Function)
        );
        // Native controls stay off: Video.js owns the control bar, and the
        // bar has to survive the tech-element swap in player.reset().
        expect(fixture.nativeElement.querySelector('video').controls).toBe(
            false
        );
        expect(
            fixture.nativeElement.querySelector('app-player-controls')
        ).toBeNull();
    });

    it('drives playback keyboard shortcuts through the legacy player', () => {
        render({
            sources: [{ src: 'https://example.test/movie.mp4' }],
            isLive: false,
        });

        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(harness.play).toHaveBeenCalledTimes(1);

        fixture.destroy();
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
                cancelable: true,
            })
        );
        expect(harness.play).toHaveBeenCalledTimes(1);
    });

    it('does not reload Video.js when options keep the same source', () => {
        const source = {
            src: 'https://example.test/live/playlist.m3u8',
            type: 'application/x-mpegURL',
        };
        render({ sources: [source] });
        harness.src.mockClear();

        fixture.componentRef.setInput('options', {
            sources: [{ ...source }],
        });
        fixture.detectChanges();

        expect(harness.src).not.toHaveBeenCalled();
        expect(harness.reset).not.toHaveBeenCalled();
    });

    it('updates Video.js directly for a different normal source', () => {
        render({
            sources: [{ src: 'https://example.test/live/one.m3u8' }],
        });

        const nextSource = {
            src: 'https://example.test/live/two.m3u8',
            type: 'application/x-mpegURL',
        };
        fixture.componentRef.setInput('options', {
            sources: [nextSource],
        });
        fixture.detectChanges();

        expect(harness.src).toHaveBeenCalledWith(nextSource);
        expect(harness.reset).not.toHaveBeenCalled();
    });

    it('resets Video.js when the source is cleared', () => {
        render({
            sources: [{ src: 'https://example.test/live/one.m3u8' }],
        });

        fixture.componentRef.setInput('options', { sources: [] });
        fixture.detectChanges();

        expect(harness.reset).toHaveBeenCalledTimes(1);
        expect(harness.src).not.toHaveBeenCalled();
    });

    it('updates volume without reloading an unchanged source', () => {
        render({
            sources: [{ src: 'https://example.test/live/playlist.m3u8' }],
        });
        harness.volume.mockClear();
        harness.src.mockClear();

        fixture.componentRef.setInput('volume', 0.75);
        fixture.detectChanges();

        expect(harness.volume).toHaveBeenCalledWith(0.75);
        expect(harness.src).not.toHaveBeenCalled();
    });

    it('does not persist reset volume and restores the current engine volume', () => {
        localStorage.setItem('volume', '0.35');
        render({
            sources: [{ src: 'https://example.test/live/playlist.m3u8' }],
        });
        harness.volume(0.35);
        harness.volume.mockClear();

        fixture.componentRef.setInput('options', { sources: [] });
        fixture.detectChanges();
        harness.volume(1);
        harness.emit('volumechange');

        expect(localStorage.getItem('volume')).toBe('0.35');

        harness.currentVideo = document.createElement('video');
        harness.emit('playerreset');

        expect(harness.volume).toHaveBeenLastCalledWith(0.35);
    });

    it('emits a diagnostic for a Video.js unsupported-source error', () => {
        const issues: Array<PlaybackDiagnostic | null> = [];
        component.playbackIssue.subscribe((issue) => issues.push(issue));
        render({
            sources: [
                {
                    src: 'https://example.test/archive/movie.mkv',
                    type: 'video/matroska',
                },
            ],
        });
        harness.currentError = {
            code: 4,
            message: 'No compatible source was found',
        };

        harness.emit('error');

        expect(issues.at(-1)).toEqual(
            expect.objectContaining({
                code: 'unsupported-container',
                source: 'native',
                sourceUrl: 'https://example.test/archive/movie.mkv',
            })
        );
    });

    it('preserves Video.js HTTP error context in a playback diagnostic', () => {
        const issues: Array<PlaybackDiagnostic | null> = [];
        component.playbackIssue.subscribe((issue) => issues.push(issue));
        harness.vhsActive = true;
        render({
            sources: [
                {
                    src: 'https://example.test/missing/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        });
        harness.currentError = {
            code: 4,
            message: 'The media could not be loaded',
            status: 404,
            metadata: { errorType: 'networkrequestfailed' },
        };

        harness.emit('error');

        expect(issues.at(-1)).toEqual(
            expect.objectContaining({
                code: 'network-error',
                source: 'vhs',
                sourceUrl: 'https://example.test/missing/playlist.m3u8',
                httpStatus: 404,
                nativeErrorMessage: undefined,
                vhs: {
                    engineType: 'networkrequestfailed',
                    mediaErrorCode: 4,
                    disposition: 'terminal',
                    stage: 'unknown',
                    httpStatus: 404,
                },
            })
        );
    });

    it('keeps a generic terminal VHS code three unknown', () => {
        const issues: Array<PlaybackDiagnostic | null> = [];
        component.playbackIssue.subscribe((issue) => issues.push(issue));
        harness.vhsActive = true;
        render({
            sources: [
                {
                    src: 'https://example.test/live/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        });
        harness.currentError = {
            code: 3,
            message:
                'Playback cannot continue. No available working or supported playlists.',
        };

        harness.emit('error');

        expect(issues.at(-1)).toEqual(
            expect.objectContaining({
                code: 'unknown-playback-error',
                source: 'vhs',
                nativeErrorMessage: undefined,
                vhs: {
                    engineType: 'unknown',
                    mediaErrorCode: 3,
                    disposition: 'terminal',
                    stage: 'unknown',
                },
            })
        );
    });

    it('keeps non-VHS native code three as media decode evidence', () => {
        const issues: Array<PlaybackDiagnostic | null> = [];
        component.playbackIssue.subscribe((issue) => issues.push(issue));
        render({
            sources: [
                {
                    src: 'https://example.test/archive/movie.mp4',
                    type: 'video/mp4',
                },
            ],
        });
        harness.currentError = {
            code: 3,
            message: 'Native media decode failed',
        };

        harness.emit('error');

        expect(issues.at(-1)).toEqual(
            expect.objectContaining({
                code: 'media-decode-error',
                source: 'native',
                nativeErrorMessage: 'Native media decode failed',
            })
        );
    });

    it('does not publish a diagnostic before the terminal VHS player error', () => {
        const issues: Array<PlaybackDiagnostic | null> = [];
        component.playbackIssue.subscribe((issue) => issues.push(issue));
        harness.vhsActive = true;
        render({
            sources: [
                {
                    src: 'https://example.test/live/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        });
        harness.currentError = {
            code: 2,
            metadata: { errorType: 'networkrequestfailed' },
        };

        harness.emit('retryplaylist');

        expect(issues).toEqual([]);

        harness.emit('error');

        expect(issues.at(-1)?.vhs?.disposition).toBe('terminal');
    });

    it('rebinds native ended handling after playerreset', () => {
        const events: string[] = [];
        component.playbackEnded.subscribe(() => events.push('ended'));
        render({
            sources: [{ src: 'https://example.test/series/one.mp4' }],
        });
        const oldVideo = harness.currentVideo;

        fixture.componentRef.setInput('options', { sources: [] });
        fixture.detectChanges();
        const replacementVideo = document.createElement('video');
        harness.currentVideo = replacementVideo;
        harness.emit('playerreset');
        oldVideo.dispatchEvent(new Event('ended'));
        replacementVideo.dispatchEvent(new Event('ended'));

        expect(events).toEqual(['ended']);
    });

    it('hides legacy series navigation when metadata is absent', () => {
        render({
            sources: [{ src: 'https://example.test/movie.mp4' }],
        });

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

    it('renders legacy series navigation with boundary state and outputs', () => {
        const events: string[] = [];
        component.previousEpisodeRequested.subscribe(() =>
            events.push('previous')
        );
        component.nextEpisodeRequested.subscribe(() => events.push('next'));
        fixture.componentRef.setInput('seriesNavigation', {
            canPrevious: false,
            canNext: true,
            autoplayEnabled: true,
        });
        render({
            sources: [{ src: 'https://example.test/series/one.mp4' }],
        });

        const previous = fixture.debugElement.query(
            By.css('[data-test-id="series-playback-previous-episode"]')
        );
        const next = fixture.debugElement.query(
            By.css('[data-test-id="series-playback-next-episode"]')
        );
        expect(previous.nativeElement.disabled).toBe(true);
        expect(next.nativeElement.disabled).toBe(false);

        previous.nativeElement.click();
        next.nativeElement.click();
        expect(events).toEqual(['next']);
    });

    function render(options: Record<string, unknown>): void {
        fixture.componentRef.setInput('options', options);
        fixture.detectChanges();
        harness.ready();
        fixture.detectChanges();
    }
});

function createPlayerHarness() {
    const listeners = new Map<string, Set<() => void>>();
    let volumeValue = 0.5;
    let mutedValue = false;
    const harness = {
        currentVideo: document.createElement('video'),
        currentError: null as NativePlaybackErrorInput | null,
        vhsActive: false,
        paused: true,
        pauseCompletesImmediately: true,
        ready: () => undefined,
        play: jest.fn(() => Promise.resolve()),
        pause: jest.fn(() => {
            if (harness.pauseCompletesImmediately) {
                harness.paused = true;
            }
        }),
        reset: jest.fn(),
        src: jest.fn(),
        volume: jest.fn((value?: number) => {
            if (value !== undefined) {
                volumeValue = value;
            }
            return volumeValue;
        }),
        muted: jest.fn((value?: boolean) => {
            if (value !== undefined) {
                mutedValue = value;
            }
            return mutedValue;
        }),
        emit(event: string) {
            for (const listener of listeners.get(event) ?? []) {
                listener();
            }
        },
        player: null as unknown as VideoJsPlayer,
    };
    harness.player = {
        audioTracks: jest.fn(() => null),
        textTracks: jest.fn(() => null),
        currentTime: jest.fn(() => 0),
        duration: jest.fn(() => 0),
        error: jest.fn(() => harness.currentError),
        getChild: jest.fn(() => null),
        on: jest.fn((event: string, listener: () => void) => {
            const eventListeners =
                listeners.get(event) ?? new Set<() => void>();
            eventListeners.add(listener);
            listeners.set(event, eventListeners);
        }),
        off: jest.fn((event: string, listener: () => void) => {
            listeners.get(event)?.delete(listener);
        }),
        pause: harness.pause,
        paused: jest.fn(() => harness.paused),
        play: harness.play,
        muted: harness.muted,
        isFullscreen: jest.fn(() => false),
        requestFullscreen: jest.fn(),
        exitFullscreen: jest.fn(),
        reset: harness.reset,
        src: harness.src,
        tech: jest.fn(() => ({
            el: () => harness.currentVideo,
            ...(harness.vhsActive ? { vhs: {} } : {}),
        })),
        volume: harness.volume,
        dispose: jest.fn(),
        qualitySelectorHls: jest.fn(),
        aspectRatioPanel: jest.fn(),
    } as unknown as VideoJsPlayer;
    return harness;
}
