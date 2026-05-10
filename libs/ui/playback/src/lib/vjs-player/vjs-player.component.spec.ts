import { SimpleChange } from '@angular/core';
import type { VjsPlayerComponent as VjsPlayerComponentInstance } from './vjs-player.component';

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
        createPlayer: jest.fn(),
        isSupported: mpegTsIsSupportedMock,
    },
}));

describe('VjsPlayerComponent', () => {
    let VjsPlayerComponent: typeof import('./vjs-player.component').VjsPlayerComponent;
    let component: VjsPlayerComponentInstance;
    let player: VjsPlayerComponentInstance['player'];

    beforeAll(async () => {
        ({ VjsPlayerComponent } = await import('./vjs-player.component'));
    });

    beforeEach(() => {
        component = new VjsPlayerComponent();
        player = {
            error: jest.fn(),
            src: jest.fn(),
            reset: jest.fn(),
            volume: jest.fn(),
        } as unknown as VjsPlayerComponentInstance['player'];
        component.player = player;
    });

    it('does not reset VideoJS when options change without changing the source', () => {
        const previousOptions = {
            sources: [
                {
                    src: 'https://example.com/live/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        };
        const currentOptions = {
            sources: [
                {
                    src: 'https://example.com/live/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        };

        component.ngOnChanges({
            options: new SimpleChange(previousOptions, currentOptions, false),
        });

        expect(player.src).not.toHaveBeenCalled();
    });

    it('updates VideoJS when options change to a different source', () => {
        const previousOptions = {
            sources: [
                {
                    src: 'https://example.com/live/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        };
        const currentOptions = {
            sources: [
                {
                    src: 'https://example.com/live/other-playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        };

        component.ngOnChanges({
            options: new SimpleChange(previousOptions, currentOptions, false),
        });

        expect(player.src).toHaveBeenCalledWith(currentOptions.sources[0]);
    });

    it('updates volume when options change without changing the source', () => {
        const previousOptions = {
            sources: [
                {
                    src: 'https://example.com/live/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        };
        const currentOptions = {
            sources: [
                {
                    src: 'https://example.com/live/playlist.m3u8',
                    type: 'application/x-mpegURL',
                },
            ],
        };

        component.ngOnChanges({
            options: new SimpleChange(previousOptions, currentOptions, false),
            volume: new SimpleChange(0.5, 0.75, false),
        });

        expect(player.src).not.toHaveBeenCalled();
        expect(player.volume).toHaveBeenCalledWith(0.75);
    });

    it('emits a playback issue when VideoJS reports an unsupported source', () => {
        const issues: unknown[] = [];
        const testComponent = component as VjsPlayerComponentInstance & {
            handleVideoJsPlaybackError: () => void;
        };
        component.options = {
            sources: [
                {
                    src: 'https://example.com/archive/movie.mkv',
                    type: 'video/matroska',
                },
            ],
        };
        jest.mocked(player.error).mockReturnValue({
            code: 4,
            message: 'No compatible source was found',
        });

        component.playbackIssue.subscribe((issue) => issues.push(issue));
        testComponent.handleVideoJsPlaybackError();

        expect(issues).toEqual([
            expect.objectContaining({
                code: 'unsupported-container',
                source: 'native',
                sourceUrl: 'https://example.com/archive/movie.mkv',
                externalFallbackRecommended: true,
            }),
        ]);
    });
});
