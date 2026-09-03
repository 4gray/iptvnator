import {
    ART_PLAYER_NATIVE_SOURCE_TYPE,
    buildArtPlayerChrome,
    exitOwnedArtPlayerFullscreen,
    getArtPlayerVideoType,
    resolveArtPlayerIsLive,
} from './art-player-setup';

describe('ArtPlayer setup', () => {
    it('preserves the legacy chrome but hands the keyboard to app shortcuts', () => {
        expect(buildArtPlayerChrome(false)).toEqual({
            pip: true,
            autoPlayback: true,
            autoSize: true,
            autoMini: true,
            screenshot: true,
            setting: true,
            playbackRate: true,
            aspectRatio: true,
            fullscreen: true,
            fullscreenWeb: true,
            airplay: true,
            hotkey: false,
        });
    });

    it('removes every duplicate ArtPlayer interaction surface in shared mode', () => {
        expect(buildArtPlayerChrome(true)).toEqual({
            controls: [],
            pip: false,
            autoPlayback: false,
            autoSize: false,
            autoMini: false,
            screenshot: false,
            setting: false,
            playbackRate: false,
            aspectRatio: false,
            fullscreen: false,
            fullscreenWeb: false,
            airplay: false,
            hotkey: false,
            fastForward: false,
            autoOrientation: false,
            lock: false,
            gesture: false,
            miniProgressBar: false,
            subtitleOffset: false,
        });
    });

    it('uses authoritative live metadata only in shared mode', () => {
        expect(
            resolveArtPlayerIsLive(true, false, 'https://example.test/movie.ts')
        ).toBe(false);
        expect(
            resolveArtPlayerIsLive(true, true, 'https://example.test/movie.mp4')
        ).toBe(true);
        expect(
            resolveArtPlayerIsLive(
                false,
                false,
                'https://example.test/movie.ts'
            )
        ).toBe(true);
        expect(
            resolveArtPlayerIsLive(
                false,
                true,
                'https://example.test/movie.mp4'
            )
        ).toBe(false);
    });

    it('keeps extensionless IPTV URLs on MPEG-TS playback', () => {
        expect(
            getArtPlayerVideoType('https://example.test/live.php?id=7')
        ).toBe('ts');
        expect(
            getArtPlayerVideoType(
                'https://example.test/play?extension=m3u8&token=signed'
            )
        ).toBe('m3u8');
        expect(getArtPlayerVideoType('https://example.test/disc.m2ts')).toBe(
            'ts'
        );
        expect(getArtPlayerVideoType('https://example.test/list.m3u')).toBe(
            'm3u8'
        );
    });

    it.each(['mkv', 'webm', 'avi', 'mov', 'm4v', 'mp4'])(
        'hands .%s files to the session-owned native type, never hls.js',
        (extension) => {
            expect(
                getArtPlayerVideoType(
                    `https://example.test/series/user/pass/80000.${extension}`
                )
            ).toBe(ART_PLAYER_NATIVE_SOURCE_TYPE);
        }
    );

    it('routes DASH manifests to the mpd custom type', () => {
        expect(getArtPlayerVideoType('https://example.test/live.mpd')).toBe(
            'mpd'
        );
        expect(
            getArtPlayerVideoType(
                'https://example.test/live.mpd?token=signed#frag'
            )
        ).toBe('mpd');
    });

    it('exits fullscreen only when the shared ArtPlayer shell owns it', () => {
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
            exitOwnedArtPlayerFullscreen(true, surface, reportError);
            expect(exitFullscreen).not.toHaveBeenCalled();

            fullscreenElement = surface;
            exitOwnedArtPlayerFullscreen(false, surface, reportError);
            expect(exitFullscreen).not.toHaveBeenCalled();

            exitOwnedArtPlayerFullscreen(true, surface, reportError);
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
