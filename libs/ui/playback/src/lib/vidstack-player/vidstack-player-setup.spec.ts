import {
    createVidstackStorage,
    resolveVidstackStreamType,
    exitOwnedVidstackFullscreen,
    formatVidstackTitle,
    resolveVidstackSource,
} from './vidstack-player-setup';

describe('resolveVidstackSource', () => {
    it.each([
        ['https://example.test/live.m3u8', 'hls', 'application/x-mpegurl'],
        ['https://example.test/live/1.ts', 'mpegts', 'video/mp4'],
        ['https://example.test/manifest.mpd', 'dash', 'video/mp4'],
        ['https://example.test/movie.mkv', 'native', 'video/mp4'],
        ['https://example.test/movie.mp4?token=1', 'native', 'video/mp4'],
    ])('routes %s to the %s engine', (url, kind, type) => {
        expect(resolveVidstackSource(url)).toEqual({
            kind,
            url,
            src: { src: url, type },
        });
    });
});

describe('resolveVidstackStreamType', () => {
    it('lets Vidstack read HLS playlists and trusts the app elsewhere', () => {
        const hls = resolveVidstackSource('https://example.test/live.m3u8');
        const ts = resolveVidstackSource('https://example.test/live/1.ts');

        expect(resolveVidstackStreamType(hls, true)).toBe('unknown');
        expect(resolveVidstackStreamType(ts, true)).toBe('live');
        expect(resolveVidstackStreamType(ts, false)).toBe('on-demand');
    });
});

describe('createVidstackStorage', () => {
    it('serves the app volume, resume position and caption preference', async () => {
        let volume = 0.6;
        let startTime = 0;
        let showCaptions = false;
        const storage = createVidstackStorage({
            getVolume: () => volume,
            getStartTime: () => startTime,
            showCaptions: () => showCaptions,
        });

        await expect(storage.getVolume()).resolves.toBe(0.6);
        await expect(storage.getMuted()).resolves.toBe(false);
        await expect(storage.getTime()).resolves.toBeNull();
        await expect(storage.getCaptions()).resolves.toBe(false);

        volume = 0;
        startTime = 90;
        showCaptions = true;
        await expect(storage.getMuted()).resolves.toBe(true);
        await expect(storage.getTime()).resolves.toBe(90);
        await expect(storage.getCaptions()).resolves.toBe(true);
    });

    it('never persists Vidstack state of its own', async () => {
        const storage = createVidstackStorage({
            getVolume: () => 1,
            getStartTime: () => 0,
            showCaptions: () => false,
        });

        expect(storage.setVolume).toBeUndefined();
        expect(storage.setTime).toBeUndefined();
        expect(storage.setCaptions).toBeUndefined();
        await expect(storage.getLang()).resolves.toBeNull();
        await expect(storage.getVideoQuality()).resolves.toBeNull();
    });
});

describe('formatVidstackTitle', () => {
    it('joins primary and secondary lines and falls back to the channel', () => {
        expect(
            formatVidstackTitle({ primary: 'Show', secondary: 'S01E02' }, 'x')
        ).toBe('Show · S01E02');
        expect(formatVidstackTitle({ primary: ' Movie ' }, 'x')).toBe('Movie');
        expect(formatVidstackTitle({ primary: '  ' }, 'Channel')).toBe(
            'Channel'
        );
        expect(formatVidstackTitle(null, '')).toBe('');
    });
});

describe('exitOwnedVidstackFullscreen', () => {
    const originalExit = document.exitFullscreen;

    afterEach(() => {
        delete (document as { fullscreenElement?: unknown }).fullscreenElement;
        document.exitFullscreen = originalExit;
    });

    function setFullscreenElement(element: Element | null): jest.Mock {
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => element,
        });
        const exit = jest.fn(() => Promise.resolve());
        document.exitFullscreen = exit;
        return exit;
    }

    it('exits only the shared controls fullscreen owner', () => {
        const surface = document.createElement('div');
        const exit = setFullscreenElement(surface);

        exitOwnedVidstackFullscreen(false, surface, jest.fn());
        exitOwnedVidstackFullscreen(
            true,
            document.createElement('div'),
            jest.fn()
        );
        expect(exit).not.toHaveBeenCalled();

        exitOwnedVidstackFullscreen(true, surface, jest.fn());
        expect(exit).toHaveBeenCalledTimes(1);
    });

    it('reports a failed exit', async () => {
        const surface = document.createElement('div');
        const exit = setFullscreenElement(surface);
        const failure = new Error('denied');
        exit.mockReturnValue(Promise.reject(failure));
        const reportError = jest.fn();

        exitOwnedVidstackFullscreen(true, surface, reportError);
        await Promise.resolve();
        await Promise.resolve();

        expect(reportError).toHaveBeenCalledWith(failure);
    });
});
