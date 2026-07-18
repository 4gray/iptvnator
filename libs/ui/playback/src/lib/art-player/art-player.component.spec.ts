import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Channel } from '@iptvnator/shared/interfaces';
import { WEB_PLAYER_SHARED_CONTROLS } from '../player-controls';
import type { ArtPlayerComponent as ArtPlayerComponentInstance } from './art-player.component';
import {
    MockArtplayer,
    MockHls,
    MockMpegTsPlayer,
    artPlayerInstances,
    getCustomType,
    hlsInstances,
    mpegTsInstances,
    resetArtPlayerSpecFixtures,
} from './art-player.component.spec-fixtures';

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
        resetArtPlayerSpecFixtures();
        localStorage.clear();

        TestBed.configureTestingModule({
            imports: [ArtPlayerComponent],
            providers: [
                { provide: WEB_PLAYER_SHARED_CONTROLS, useValue: false },
            ],
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

        getCustomType('video/matroska')(
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

    it('applies volume input changes without recreating the player', () => {
        createComponent({
            url: 'https://example.com/live/channel.m3u8',
            name: 'HLS Live',
        });
        const player = artPlayerInstances[0];

        fixture.componentRef.setInput('volume', 0.37);
        fixture.detectChanges();

        expect(player.volume).toBe(0.37);
        expect(artPlayerInstances).toHaveLength(1);
    });

    it('applies a simultaneous volume change after rebuilding the legacy player', () => {
        localStorage.setItem(
            'artplayer_settings',
            JSON.stringify({ volume: 0.2 })
        );
        createComponent({
            url: 'https://example.com/live/first.m3u8',
            name: 'First channel',
        });

        fixture.componentRef.setInput('channel', {
            url: 'https://example.com/live/second.m3u8',
            name: 'Second channel',
        });
        fixture.componentRef.setInput('volume', 0.73);
        fixture.detectChanges();

        expect(artPlayerInstances).toHaveLength(2);
        expect(artPlayerInstances[1].volume).toBe(0.73);
    });

    it('keeps the complete ArtPlayer skin and legacy series controls when the flag is off', () => {
        createComponent({
            url: 'https://example.com/movie.mp4',
            name: 'Movie',
        });

        expect(artPlayerInstances[0].options).toEqual(
            expect.objectContaining({
                autoPlayback: true,
                autoSize: true,
                autoMini: true,
                setting: true,
                fullscreen: true,
                fullscreenWeb: true,
            })
        );
        expect(artPlayerInstances[0].options['hotkey']).toBeUndefined();
        expect(
            fixture.debugElement.query(By.css('app-player-controls'))
        ).toBeNull();
        expect(
            fixture.debugElement.query(
                By.css('.art-player-interaction-capture')
            )
        ).toBeNull();
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
        mpegTsInstances[0].handlers.get('error')?.(
            'mediaError',
            'unsupported codec',
            {}
        );

        expect(issues).toEqual([
            expect.objectContaining({
                code: 'unsupported-codec',
                source: 'mpegts',
                sourceUrl: 'https://example.com/live/channel.ts',
                externalFallbackRecommended: true,
            }),
        ]);
    });

    it('emits playbackEnded exactly once for a native ended event and not during reload or destroy', () => {
        const events: string[] = [];
        createComponent({
            url: 'https://example.com/series/s01e02.mp4',
            name: 'Episode 2',
        });
        (
            component as unknown as {
                playbackEnded: {
                    subscribe: (fn: () => void) => { unsubscribe: () => void };
                };
            }
        ).playbackEnded.subscribe(() => events.push('ended'));

        artPlayerInstances[0].video.dispatchEvent(new Event('ended'));
        fixture.componentRef.setInput('channel', {
            url: 'https://example.com/series/s01e03.mp4',
            name: 'Episode 3',
        });
        fixture.detectChanges();
        fixture.destroy();

        expect(events).toEqual(['ended']);
    });

    it('hides series navigation controls when series navigation is absent', () => {
        createComponent({
            url: 'https://example.com/movie.mp4',
            name: 'Movie',
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

    it('renders series navigation controls with boundary disabled state', () => {
        const events: string[] = [];
        createComponent({
            url: 'https://example.com/series/s01e10.mp4',
            name: 'Episode 10',
        });
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

    function createComponent(channel: Pick<Channel, 'url' | 'name'>): void {
        fixture = TestBed.createComponent(ArtPlayerComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('channel', channel);
        fixture.detectChanges();
    }
});
