import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls/web-player-controls.flag';
import type { VjsPlayerComponent as VjsPlayerComponentInstance } from './vjs-player.component';
import type {
    VideoJsPlayer,
    VideoJsTextTrack,
    VideoJsTextTrackList,
} from './vjs-player.types';

const videoJsMock = jest.fn();

jest.unstable_mockModule('video.js', () => ({ default: videoJsMock }));
jest.unstable_mockModule('@yangkghjh/videojs-aspect-ratio-panel', () => ({}));
jest.unstable_mockModule('videojs-contrib-quality-levels', () => ({}));
jest.unstable_mockModule('videojs-quality-selector-hls', () => ({}));
jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: jest.fn(),
        isSupported: jest.fn(() => false),
    },
}));

/**
 * Regression coverage for #1155: with Video.js' own control bar (shared
 * controls off, the shipping default) the `showCaptions` preference was never
 * read, so a VHS rendition flagged DEFAULT kept subtitles on screen.
 */
describe('VjsPlayerComponent caption preference without shared controls', () => {
    let VjsPlayerComponent: typeof import('./vjs-player.component').VjsPlayerComponent;
    let fixture: ComponentFixture<VjsPlayerComponentInstance>;
    let harness: ReturnType<typeof createHarness>;

    beforeAll(async () => {
        ({ VjsPlayerComponent } = await import('./vjs-player.component'));
    });

    beforeEach(async () => {
        harness = createHarness();
        videoJsMock
            .mockReset()
            .mockImplementation(
                (_target: Element, _options: unknown, ready: () => void) => {
                    harness.ready = ready;
                    return harness.player;
                }
            );
        await TestBed.configureTestingModule({
            imports: [VjsPlayerComponent],
            // "without shared controls" — pin the opt-out explicitly now that
            // shared controls default on.
            providers: [
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: false },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(VjsPlayerComponent);
    });

    afterEach(() => {
        if (!fixture.componentRef.hostView.destroyed) {
            fixture.destroy();
        }
        localStorage.removeItem('volume');
    });

    it('suppresses initial and late default captions while the preference is off', () => {
        const initial = createTextTrack({
            kind: 'captions',
            mode: 'showing',
        });
        harness.tracks.replaceSilently([initial]);
        render(false);

        expect(initial.mode).toBe('disabled');

        const late = createTextTrack({ kind: 'subtitles', mode: 'showing' });
        harness.tracks.add(late);

        expect(late.mode).toBe('disabled');
    });

    it('keeps captions displayed while the preference is on', () => {
        const track = createTextTrack({ kind: 'captions', mode: 'showing' });
        harness.tracks.replaceSilently([track]);
        render(true);

        expect(track.mode).toBe('showing');
    });

    // The Video.js control bar stays visible in this mode, so the preference
    // must seed the source and then get out of the user's way.
    it('keeps a caption the user enables after playback started', () => {
        const track = createTextTrack({ kind: 'captions', mode: 'showing' });
        harness.tracks.replaceSilently([track]);
        render(false);
        expect(track.mode).toBe('disabled');

        harness.emit('playing');
        track.mode = 'showing';
        harness.tracks.emit('change');

        expect(track.mode).toBe('showing');
    });

    it('restores the suppressed track when the preference is turned on', () => {
        const track = createTextTrack({ kind: 'captions', mode: 'showing' });
        harness.tracks.replaceSilently([track]);
        render(false);
        expect(track.mode).toBe('disabled');

        fixture.componentRef.setInput('showCaptions', true);
        fixture.detectChanges();

        expect(track.mode).toBe('showing');
    });

    it('re-applies the preference to the text tracks of a new source', () => {
        render(false);

        const replacement = createTextTrack({
            kind: 'subtitles',
            mode: 'showing',
        });
        harness.tracks.replaceSilently([replacement]);
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/second.mp4' }],
        });
        fixture.detectChanges();
        harness.emit('loadedmetadata');

        expect(replacement.mode).toBe('disabled');
    });

    it('stops managing text tracks once the component is destroyed', () => {
        const track = createTextTrack({ kind: 'captions', mode: 'showing' });
        harness.tracks.replaceSilently([track]);
        render(false);

        fixture.destroy();
        track.mode = 'showing';
        harness.tracks.emit('change');

        expect(track.mode).toBe('showing');
    });

    function render(showCaptions: boolean): void {
        fixture.componentRef.setInput('showCaptions', showCaptions);
        fixture.componentRef.setInput('options', {
            sources: [{ src: 'https://example.test/first.mp4' }],
        });
        fixture.detectChanges();
        harness.ready();
        fixture.detectChanges();
    }
});

function createTextTrack(
    overrides: Partial<VideoJsTextTrack> = {}
): VideoJsTextTrack {
    return { kind: 'subtitles', mode: 'disabled', ...overrides };
}

class FakeTextTrackList {
    private tracks: VideoJsTextTrack[] = [];
    private indexedLength = 0;
    private readonly listeners = new Map<
        string,
        Set<EventListenerOrEventListenerObject>
    >();

    readonly addEventListener = jest.fn(
        (event: string, listener: EventListenerOrEventListenerObject): void => {
            const registered = this.listeners.get(event) ?? new Set();
            registered.add(listener);
            this.listeners.set(event, registered);
        }
    );

    readonly removeEventListener = jest.fn(
        (event: string, listener: EventListenerOrEventListenerObject): void => {
            this.listeners.get(event)?.delete(listener);
        }
    );

    get length(): number {
        return this.tracks.length;
    }

    replaceSilently(tracks: VideoJsTextTrack[]): void {
        this.tracks = [...tracks];
        this.syncIndexedTracks();
    }

    add(track: VideoJsTextTrack): void {
        this.tracks.push(track);
        this.syncIndexedTracks();
        this.emit('addtrack');
    }

    emit(eventName: 'addtrack' | 'removetrack' | 'change'): void {
        const event = new Event(eventName);
        for (const listener of this.listeners.get(eventName) ?? []) {
            if (typeof listener === 'function') {
                listener.call(this, event);
            } else {
                listener.handleEvent(event);
            }
        }
    }

    asTextTrackList(): VideoJsTextTrackList {
        return this as unknown as VideoJsTextTrackList;
    }

    private syncIndexedTracks(): void {
        for (let index = 0; index < this.indexedLength; index += 1) {
            Reflect.deleteProperty(this, index);
        }
        this.tracks.forEach((track, index) => {
            Object.defineProperty(this, index, {
                configurable: true,
                enumerable: true,
                value: track,
            });
        });
        this.indexedLength = this.tracks.length;
    }
}

function createHarness() {
    const listeners = new Map<string, Set<() => void>>();
    const tracks = new FakeTextTrackList();
    const harness = {
        tracks,
        currentVideo: document.createElement('video'),
        ready: () => undefined,
        emit(event: string) {
            for (const listener of listeners.get(event) ?? []) {
                listener();
            }
        },
        player: null as unknown as VideoJsPlayer,
    };
    harness.player = {
        audioTracks: jest.fn(() => null),
        textTracks: jest.fn(() => tracks.asTextTrackList()),
        currentTime: jest.fn(() => 0),
        duration: jest.fn(() => 0),
        error: jest.fn(() => null),
        getChild: jest.fn(() => null),
        on: jest.fn((event: string, listener: () => void) => {
            const registered = listeners.get(event) ?? new Set<() => void>();
            registered.add(listener);
            listeners.set(event, registered);
        }),
        off: jest.fn((event: string, listener: () => void) => {
            listeners.get(event)?.delete(listener);
        }),
        pause: jest.fn(),
        paused: jest.fn(() => true),
        reset: jest.fn(),
        src: jest.fn(),
        tech: jest.fn(() => ({ el: () => harness.currentVideo })),
        volume: jest.fn(() => 1),
        dispose: jest.fn(),
        qualitySelectorHls: jest.fn(),
        aspectRatioPanel: jest.fn(),
    } as unknown as VideoJsPlayer;
    return harness;
}
