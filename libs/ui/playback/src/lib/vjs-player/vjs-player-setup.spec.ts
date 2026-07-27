import {
    createVjsPlayerOptions,
    exitOwnedVjsFullscreen,
    hasVjsMpegTsModeChanged,
    hasVjsPlaybackInputChanged,
    initializeVjsPlugins,
    shouldChangeVjsSource,
} from './vjs-player-setup';
import type { VideoJsPlayer } from './vjs-player.types';

describe('Video.js player setup', () => {
    it('preserves legacy options when shared controls are disabled', () => {
        const options = {
            sources: [{ src: 'https://example.test/movie.mp4' }],
            userActions: { hotkeys: true },
            spatialNavigation: { enabled: true },
        };

        expect(createVjsPlayerOptions(options, false, false)).toEqual({
            ...options,
            autoplay: true,
        });
    });

    it('removes duplicate Video.js interaction ownership for shared controls', () => {
        expect(
            createVjsPlayerOptions(
                {
                    sources: [{ src: 'https://example.test/live.ts' }],
                    userActions: { custom: true, hotkeys: true },
                    spatialNavigation: { custom: true, enabled: true },
                },
                true,
                true
            )
        ).toEqual(
            expect.objectContaining({
                sources: [],
                autoplay: false,
                controls: false,
                userActions: {
                    custom: true,
                    click: false,
                    doubleClick: false,
                    hotkeys: false,
                },
                spatialNavigation: {
                    custom: true,
                    enabled: false,
                },
            })
        );
    });

    it('detects source identity and explicit reload changes', () => {
        const source = {
            src: 'https://example.test/movie.mp4',
            type: 'video/mp4',
        };

        expect(
            hasVjsPlaybackInputChanged(
                { reloadToken: 1 },
                { reloadToken: 1 },
                source,
                { ...source }
            )
        ).toBe(false);
        expect(
            hasVjsPlaybackInputChanged(
                { reloadToken: 1 },
                { reloadToken: 2 },
                source,
                source
            )
        ).toBe(true);
        expect(
            hasVjsPlaybackInputChanged({}, {}, source, {
                ...source,
                type: 'application/octet-stream',
            })
        ).toBe(true);
    });

    it('detects only semantic live-mode changes for raw MPEG-TS', () => {
        expect(
            hasVjsMpegTsModeChanged(
                { isLive: undefined },
                { isLive: true },
                true
            )
        ).toBe(false);
        expect(
            hasVjsMpegTsModeChanged({ isLive: true }, { isLive: false }, true)
        ).toBe(true);
        expect(
            hasVjsMpegTsModeChanged({ isLive: true }, { isLive: false }, false)
        ).toBe(false);
    });

    it('combines source identity and raw MPEG-TS live-mode changes', () => {
        const isMpegTsSource = jest.fn(() => true);

        expect(
            shouldChangeVjsSource(
                {
                    isLive: true,
                    sources: [{ src: 'https://example.test/live.ts' }],
                },
                {
                    isLive: false,
                    sources: [{ src: 'https://example.test/live.ts' }],
                },
                isMpegTsSource
            )
        ).toBe(true);
        expect(isMpegTsSource).toHaveBeenCalledWith(
            'https://example.test/live.ts'
        );
    });

    it('initializes optional plugins independently', () => {
        const qualitySelectorHls = jest.fn(() => {
            throw new Error('quality failed');
        });
        const aspectRatioPanel = jest.fn();
        const warn = jest.spyOn(console, 'warn').mockImplementation();

        initializeVjsPlugins({
            qualitySelectorHls,
            aspectRatioPanel,
        } as unknown as VideoJsPlayer);

        expect(qualitySelectorHls).toHaveBeenCalledWith({
            displayCurrentQuality: true,
        });
        expect(aspectRatioPanel).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            'qualitySelectorHls plugin failed to initialize:',
            expect.any(Error)
        );
        warn.mockRestore();
    });

    it('exits fullscreen only when the shared Video.js shell owns it', () => {
        const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'fullscreenElement'
        );
        const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'exitFullscreen'
        );
        const surface = document.createElement('div');
        let fullscreenElement: Element | null = document.createElement('div');
        const exitFullscreen = jest.fn().mockResolvedValue(undefined);
        const reportError = jest.fn();

        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement,
        });
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreen,
        });

        try {
            exitOwnedVjsFullscreen(true, surface, reportError);
            expect(exitFullscreen).not.toHaveBeenCalled();

            fullscreenElement = surface;
            exitOwnedVjsFullscreen(false, surface, reportError);
            expect(exitFullscreen).not.toHaveBeenCalled();

            exitOwnedVjsFullscreen(true, surface, reportError);
            expect(exitFullscreen).toHaveBeenCalledTimes(1);
            expect(reportError).not.toHaveBeenCalled();
        } finally {
            restoreDocumentProperty(
                'fullscreenElement',
                fullscreenElementDescriptor
            );
            restoreDocumentProperty('exitFullscreen', exitFullscreenDescriptor);
        }
    });
});

function restoreDocumentProperty(
    property: 'exitFullscreen' | 'fullscreenElement',
    descriptor: PropertyDescriptor | undefined
): void {
    if (descriptor) {
        Object.defineProperty(document, property, descriptor);
        return;
    }

    delete (document as unknown as Record<string, unknown>)[property];
}
