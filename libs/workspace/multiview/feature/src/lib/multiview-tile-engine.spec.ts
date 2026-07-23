import { MultiviewTileEngine } from './multiview-tile-engine';

jest.mock('hls.js', () => {
    class MockHls {
        static instances: MockHls[] = [];
        static isSupported = jest.fn(() => true);
        static Events = {
            MANIFEST_PARSED: 'manifestParsed',
            ERROR: 'hlsError',
        };

        readonly config: unknown;
        private readonly handlers = new Map<
            string,
            (event: string, data: never) => void
        >();
        attachMedia = jest.fn();
        loadSource = jest.fn();
        destroy = jest.fn();

        constructor(config: unknown) {
            this.config = config;
            MockHls.instances.push(this);
        }

        on(event: string, handler: (event: string, data: never) => void): void {
            this.handlers.set(event, handler);
        }

        emit(event: string, data: unknown): void {
            this.handlers.get(event)?.(event, data as never);
        }
    }

    return { __esModule: true, default: MockHls };
});

jest.mock('mpegts.js', () => {
    class MockMpegtsPlayer {
        private readonly handlers = new Map<
            string,
            (...args: unknown[]) => void
        >();
        attachMediaElement = jest.fn();
        detachMediaElement = jest.fn();
        load = jest.fn();
        unload = jest.fn();
        pause = jest.fn();
        destroy = jest.fn();

        on(event: string, handler: (...args: unknown[]) => void): void {
            this.handlers.set(event, handler);
        }

        emit(event: string, ...args: unknown[]): void {
            this.handlers.get(event)?.(...args);
        }
    }

    const players: MockMpegtsPlayer[] = [];

    return {
        __esModule: true,
        default: {
            players,
            isSupported: jest.fn(() => true),
            createPlayer: jest.fn(() => {
                const player = new MockMpegtsPlayer();
                players.push(player);
                return player;
            }),
            Events: { ERROR: 'error' },
        },
    };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const MockHls = jest.requireMock('hls.js').default as any;
const mpegtsMock = jest.requireMock('mpegts.js').default as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function createVideo(): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'play', {
        value: jest.fn().mockResolvedValue(undefined),
        writable: true,
    });
    Object.defineProperty(video, 'pause', {
        value: jest.fn(),
        writable: true,
    });
    Object.defineProperty(video, 'load', {
        value: jest.fn(),
        writable: true,
    });
    return video;
}

describe('MultiviewTileEngine', () => {
    beforeEach(() => {
        MockHls.instances.length = 0;
        mpegtsMock.players.length = 0;
        jest.clearAllMocks();
        MockHls.isSupported.mockReturnValue(true);
        mpegtsMock.isSupported.mockReturnValue(true);
    });

    it('uses mpegts.js for .ts URLs and starts muted', () => {
        const video = createVideo();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.ts',
            onError: jest.fn(),
        });

        engine.start();

        expect(mpegtsMock.createPlayer).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'mpegts',
                isLive: true,
                url: 'http://example.com/stream.ts',
            }),
            expect.any(Object)
        );
        expect(mpegtsMock.players[0].attachMediaElement).toHaveBeenCalledWith(
            video
        );
        expect(mpegtsMock.players[0].load).toHaveBeenCalled();
        expect(video.muted).toBe(true);
        expect(video.play).toHaveBeenCalled();
    });

    it('uses hls.js with bounded buffers for HLS URLs', () => {
        const video = createVideo();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.m3u8',
            onError: jest.fn(),
        });

        engine.start();

        expect(MockHls.instances).toHaveLength(1);
        expect(MockHls.instances[0].config).toEqual(
            expect.objectContaining({
                maxBufferLength: 10,
                backBufferLength: 0,
            })
        );
        expect(MockHls.instances[0].attachMedia).toHaveBeenCalledWith(video);
        expect(MockHls.instances[0].loadSource).toHaveBeenCalledWith(
            'http://example.com/stream.m3u8'
        );
    });

    it('falls back to a native source for mp4 URLs', () => {
        const video = createVideo();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/movie.mp4',
            onError: jest.fn(),
        });

        engine.start();

        expect(MockHls.instances).toHaveLength(0);
        expect(mpegtsMock.players).toHaveLength(0);
        const source = video.querySelector('source');
        expect(source?.getAttribute('src')).toBe(
            'http://example.com/movie.mp4'
        );
        expect(video.play).toHaveBeenCalled();
    });

    it('reports fatal hls errors and ignores non-fatal ones', () => {
        const video = createVideo();
        const onError = jest.fn();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.m3u8',
            onError,
        });
        engine.start();

        MockHls.instances[0].emit('hlsError', {
            type: 'networkError',
            details: 'manifestLoadError',
            fatal: false,
        });
        expect(onError).not.toHaveBeenCalled();

        MockHls.instances[0].emit('hlsError', {
            type: 'networkError',
            details: 'manifestLoadError',
            fatal: true,
        });
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError.mock.calls[0][0]).toEqual(
            expect.objectContaining({
                sourceUrl: 'http://example.com/stream.m3u8',
            })
        );
    });

    it('reports mpegts errors but ignores explicitly non-fatal ones', () => {
        const video = createVideo();
        const onError = jest.fn();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.ts',
            onError,
        });
        engine.start();

        mpegtsMock.players[0].emit('error', 'NetworkError', 'Exception', {
            fatal: false,
        });
        expect(onError).not.toHaveBeenCalled();

        mpegtsMock.players[0].emit('error', 'NetworkError', 'Exception', {});

        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('invokes onPlaying once the video reports playback', () => {
        const video = createVideo();
        const onPlaying = jest.fn();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.m3u8',
            onError: jest.fn(),
            onPlaying,
        });
        engine.start();

        MockHls.instances[0].emit('manifestParsed', {});
        video.dispatchEvent(new Event('playing'));
        video.dispatchEvent(new Event('playing'));

        expect(onPlaying).toHaveBeenCalledTimes(1);
    });

    it('is idempotent for start and destroy', () => {
        const video = createVideo();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.m3u8',
            onError: jest.fn(),
        });

        engine.start();
        engine.start();
        expect(MockHls.instances).toHaveLength(1);

        engine.destroy();
        engine.destroy();
        expect(MockHls.instances[0].destroy).toHaveBeenCalledTimes(1);
    });

    it('cleans up the mpegts player on destroy', () => {
        const video = createVideo();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.ts',
            onError: jest.fn(),
        });
        engine.start();

        engine.destroy();

        const player = mpegtsMock.players[0];
        expect(player.pause).toHaveBeenCalled();
        expect(player.unload).toHaveBeenCalled();
        expect(player.detachMediaElement).toHaveBeenCalled();
        expect(player.destroy).toHaveBeenCalled();
    });

    it('does not start after destroy and swallows late errors', () => {
        const video = createVideo();
        const onError = jest.fn();
        const engine = new MultiviewTileEngine({
            video,
            url: 'http://example.com/stream.m3u8',
            onError,
        });
        engine.start();
        const hls = MockHls.instances[0];

        engine.destroy();
        hls.emit('hlsError', {
            type: 'networkError',
            details: 'manifestLoadError',
            fatal: true,
        });
        expect(onError).not.toHaveBeenCalled();

        engine.start();
        expect(MockHls.instances).toHaveLength(1);
    });
});
