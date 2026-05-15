import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Channel } from '@iptvnator/shared/interfaces';
import type { ArtPlayerComponent as ArtPlayerComponentInstance } from './art-player.component';

const artPlayerInstances: MockArtplayer[] = [];
const hlsInstances: MockHls[] = [];
const mpegTsInstances: MockMpegTsPlayer[] = [];

class MockArtplayer {
    static AUTO_PLAYBACK_TIMEOUT = 0;

    readonly video = document.createElement('video');
    readonly setting = { add: jest.fn() };
    readonly on = jest.fn();
    readonly destroy = jest.fn();
    readonly currentTime = 0;
    readonly duration = 0;

    constructor(readonly options: Record<string, unknown>) {
        artPlayerInstances.push(this);
    }
}

class MockHls {
    static Events = {
        MANIFEST_PARSED: 'manifestParsed',
        ERROR: 'error',
        AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
    };

    static isSupported = jest.fn(() => true);

    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly on = jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        this.handlers.set(event, handler);
    });
    readonly loadSource = jest.fn();
    readonly attachMedia = jest.fn();
    readonly destroy = jest.fn();
    readonly audioTracks: unknown[] = [];

    constructor() {
        hlsInstances.push(this);
    }
}

class MockMpegTsPlayer {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly attachMediaElement = jest.fn();
    readonly on = jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        this.handlers.set(event, handler);
    });
    readonly load = jest.fn();
    readonly play = jest.fn();
    readonly pause = jest.fn();
    readonly unload = jest.fn();
    readonly detachMediaElement = jest.fn();
    readonly destroy = jest.fn();

    constructor() {
        mpegTsInstances.push(this);
    }
}

jest.unstable_mockModule('artplayer', () => ({
    default: MockArtplayer,
}));

jest.unstable_mockModule('hls.js', () => ({
    default: MockHls,
}));

jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: {
            ERROR: 'error',
        },
        createPlayer: jest.fn(() => new MockMpegTsPlayer()),
        isSupported: jest.fn(() => true),
    },
}));

describe('ArtPlayerComponent', () => {
    let ArtPlayerComponent: typeof import('./art-player.component').ArtPlayerComponent;
    let fixture: ComponentFixture<ArtPlayerComponentInstance>;
    let component: ArtPlayerComponentInstance;

    beforeAll(async () => {
        ({ ArtPlayerComponent } = await import('./art-player.component'));
    });

    beforeEach(() => {
        artPlayerInstances.length = 0;
        hlsInstances.length = 0;
        mpegTsInstances.length = 0;

        TestBed.configureTestingModule({
            imports: [ArtPlayerComponent],
        });
    });

    afterEach(() => {
        fixture?.destroy();
    });

    it('emits a playback issue when the native video element reports an unsupported source', () => {
        createComponent({
            url: 'https://example.com/archive/movie.mkv',
            name: 'MKV Movie',
        });
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });

        Object.defineProperty(artPlayerInstances[0].video, 'error', {
            configurable: true,
            value: {
                code: 4,
                message: 'No compatible source was found',
            },
        });

        getCustomType('mkv')(
            artPlayerInstances[0].video,
            'https://example.com/archive/movie.mkv'
        );
        expect(artPlayerInstances[0].video.onerror).toBeNull();
        artPlayerInstances[0].video.dispatchEvent(new Event('error'));

        expect(issues).toEqual([
            expect.objectContaining({
                code: 'unsupported-container',
                source: 'native',
                sourceUrl: 'https://example.com/archive/movie.mkv',
                externalFallbackRecommended: true,
            }),
        ]);
    });

    it('emits a playback issue when HLS.js reports an unsupported codec', () => {
        createComponent({
            url: 'https://example.com/live/playlist.m3u8',
            name: 'HLS Live',
        });
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });

        getCustomType('m3u8')(
            artPlayerInstances[0].video,
            'https://example.com/live/playlist.m3u8'
        );
        hlsInstances[0].handlers.get(MockHls.Events.ERROR)?.(null, {
            type: 'mediaError',
            details: 'bufferAddCodecError',
            fatal: true,
            error: new Error('codec unsupported'),
        });

        expect(issues).toEqual([
            expect.objectContaining({
                code: 'unsupported-codec',
                source: 'hls',
                sourceUrl: 'https://example.com/live/playlist.m3u8',
                externalFallbackRecommended: true,
            }),
        ]);
    });

    it('does not emit a playback issue when HLS.js reports a recoverable error', () => {
        createComponent({
            url: 'https://example.com/live/playlist.m3u8',
            name: 'HLS Live',
        });
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });

        getCustomType('m3u8')(
            artPlayerInstances[0].video,
            'https://example.com/live/playlist.m3u8'
        );
        hlsInstances[0].handlers.get(MockHls.Events.ERROR)?.(null, {
            type: 'networkError',
            details: 'fragLoadError',
            fatal: false,
            error: new Error('segment retry'),
        });

        expect(issues).toEqual([]);
    });

    it('uses HLS playback for URLs with a query-declared m3u8 extension', () => {
        createComponent({
            url: 'https://example.com/play?extension=m3u8&token=signed',
            name: 'Signed HLS Live',
        });

        expect(artPlayerInstances[0].options['type']).toBe('m3u8');
        expect(artPlayerInstances[0].options['isLive']).toBe(true);
    });

    it('emits a playback issue when mpegts.js reports an unsupported codec', () => {
        createComponent({
            url: 'https://example.com/live/channel.ts',
            name: 'TS Live',
        });
        const issues: unknown[] = [];
        component.playbackIssue.subscribe((issue) => {
            if (issue) issues.push(issue);
        });

        getCustomType('ts')(
            artPlayerInstances[0].video,
            'https://example.com/live/channel.ts'
        );
        mpegTsInstances[0].handlers
            .get('error')
            ?.('mediaError', 'unsupported codec', {});

        expect(issues).toEqual([
            expect.objectContaining({
                code: 'unsupported-codec',
                source: 'mpegts',
                sourceUrl: 'https://example.com/live/channel.ts',
                externalFallbackRecommended: true,
            }),
        ]);
    });

    function createComponent(channel: Pick<Channel, 'url' | 'name'>): void {
        fixture = TestBed.createComponent(ArtPlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('channel', channel);
        fixture.detectChanges();
    }

    function getCustomType(
        type: 'm3u8' | 'ts' | 'mkv'
    ): (video: HTMLVideoElement, url: string) => void {
        return (
            artPlayerInstances[0].options['customType'] as Record<
                string,
                (video: HTMLVideoElement, url: string) => void
            >
        )[type];
    }
});
