const createPlayerMock = jest.fn();
const isSupportedMock = jest.fn(() => true);
let VjsMpegTsSession: typeof import('./vjs-mpegts-session').VjsMpegTsSession;

jest.unstable_mockModule('mpegts.js', () => ({
    default: {
        Events: { ERROR: 'error' },
        createPlayer: createPlayerMock,
        isSupported: isSupportedMock,
    },
}));

describe('VjsMpegTsSession', () => {
    beforeAll(async () => {
        ({ VjsMpegTsSession } = await import('./vjs-mpegts-session'));
    });

    beforeEach(() => {
        createPlayerMock.mockReset();
        isSupportedMock.mockReset().mockReturnValue(true);
    });

    it('recognizes raw MPEG-TS sources without stealing declared HLS URLs', () => {
        const session = createSession().session;

        expect(
            session.isSupportedSource(
                'https://example.test/play?extension=m3u8&token=x'
            )
        ).toBe(false);
        expect(
            session.isSupportedSource(
                'https://example.test/live.php?extension=ts'
            )
        ).toBe(true);
        expect(
            session.isSupportedSource(
                'https://example.test/live.php?stream=123'
            )
        ).toBe(true);

        isSupportedMock.mockReturnValue(false);
        expect(
            session.isSupportedSource('https://example.test/live/stream.ts')
        ).toBe(false);
        expect(session.isSupportedSource()).toBe(false);
    });

    it('attaches VOD playback to the explicit current Tech video', () => {
        const mpegTsPlayer = createMpegTsPlayer();
        createPlayerMock.mockReturnValue(mpegTsPlayer);
        const video = document.createElement('video');
        const { session } = createSession({ isLive: false });

        session.start('https://example.test/archive/movie.ts', video);

        expect(createPlayerMock).toHaveBeenCalledWith({
            type: 'mpegts',
            isLive: false,
            url: 'https://example.test/archive/movie.ts',
        });
        expect(mpegTsPlayer.attachMediaElement).toHaveBeenCalledWith(video);
        expect(mpegTsPlayer.load).toHaveBeenCalledTimes(1);
        expect(mpegTsPlayer.play).toHaveBeenCalledTimes(1);
    });

    it('handles an asynchronous autoplay rejection', () => {
        const catchRejection = jest.fn();
        const mpegTsPlayer = createMpegTsPlayer();
        mpegTsPlayer.play.mockReturnValue({
            catch: catchRejection,
        } as unknown as Promise<void>);
        createPlayerMock.mockReturnValue(mpegTsPlayer);
        const video = document.createElement('video');
        const { session } = createSession();

        session.start('https://example.test/live/stream.ts', video);

        expect(catchRejection).toHaveBeenCalledWith(expect.any(Function));
        expect(
            catchRejection.mock.calls[0][0](new Error('autoplay blocked'))
        ).toBeUndefined();
    });

    it('normalizes VOD duration from seekable and then buffered ranges', async () => {
        const mpegTsPlayer = createMpegTsPlayer();
        createPlayerMock.mockReturnValue(mpegTsPlayer);
        const video = document.createElement('video');
        Object.defineProperty(video, 'seekable', {
            configurable: true,
            value: createTimeRanges([[0, 164.072]]),
        });
        Object.defineProperty(video, 'buffered', {
            configurable: true,
            value: createTimeRanges([[0, 200]]),
        });
        const { session, duration } = createSession({ isLive: false });

        session.start('https://example.test/archive/movie.ts', video);
        video.dispatchEvent(new Event('progress'));
        await Promise.resolve();

        expect(duration).toHaveBeenCalledWith(164.072);

        Object.defineProperty(video, 'seekable', {
            configurable: true,
            value: createTimeRanges([]),
        });
        video.dispatchEvent(new Event('durationchange'));

        expect(duration).toHaveBeenCalledWith(200);
    });

    it('classifies engine errors with Video.js source metadata', () => {
        const mpegTsPlayer = createMpegTsPlayer();
        createPlayerMock.mockReturnValue(mpegTsPlayer);
        const video = document.createElement('video');
        const { session, emitPlaybackIssue } = createSession();

        session.start('https://example.test/live/stream.ts', video);
        mpegTsPlayer.emit(
            'error',
            'NetworkError',
            'FetchError',
            new Error('CORS blocked')
        );

        expect(emitPlaybackIssue).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'browser-access-error',
                source: 'mpegts',
                sourceUrl: 'https://example.test/live/stream.ts',
                player: 'videojs',
            })
        );
    });

    it('replaces an active session and removes listeners from the old video', () => {
        const firstPlayer = createMpegTsPlayer();
        const secondPlayer = createMpegTsPlayer();
        createPlayerMock
            .mockReturnValueOnce(firstPlayer)
            .mockReturnValueOnce(secondPlayer);
        const firstVideo = document.createElement('video');
        const secondVideo = document.createElement('video');
        const removeEventListener = jest.spyOn(
            firstVideo,
            'removeEventListener'
        );
        const { session } = createSession({ isLive: false });

        session.start('https://example.test/archive/one.ts', firstVideo);
        session.start('https://example.test/archive/two.ts', secondVideo);

        expect(removeEventListener).toHaveBeenCalledTimes(5);
        expect(firstPlayer.off).toHaveBeenCalledWith(
            'error',
            expect.any(Function)
        );
        expect(firstPlayer.pause).toHaveBeenCalledTimes(1);
        expect(firstPlayer.unload).toHaveBeenCalledTimes(1);
        expect(firstPlayer.detachMediaElement).toHaveBeenCalledTimes(1);
        expect(firstPlayer.destroy).toHaveBeenCalledTimes(1);
        expect(secondPlayer.attachMediaElement).toHaveBeenCalledWith(
            secondVideo
        );
    });

    it('destroys idempotently and ignores events after teardown', () => {
        const mpegTsPlayer = createMpegTsPlayer();
        createPlayerMock.mockReturnValue(mpegTsPlayer);
        const video = document.createElement('video');
        const { session, duration, emitPlaybackIssue } = createSession({
            isLive: false,
        });

        session.start('https://example.test/archive/movie.ts', video);
        duration.mockClear();
        session.destroy();
        session.destroy();
        video.dispatchEvent(new Event('progress'));
        mpegTsPlayer.emit(
            'error',
            'NetworkError',
            'FetchError',
            new Error('failed')
        );

        expect(duration).not.toHaveBeenCalled();
        expect(emitPlaybackIssue).not.toHaveBeenCalled();
        expect(mpegTsPlayer.pause).toHaveBeenCalledTimes(1);
        expect(mpegTsPlayer.unload).toHaveBeenCalledTimes(1);
        expect(mpegTsPlayer.detachMediaElement).toHaveBeenCalledTimes(1);
        expect(mpegTsPlayer.destroy).toHaveBeenCalledTimes(1);
    });
});

function createSession(options: { isLive?: boolean } = {}) {
    let currentDuration = Number.POSITIVE_INFINITY;
    const duration = jest.fn((value?: number) => {
        if (value !== undefined) {
            currentDuration = value;
        }
        return currentDuration;
    });
    const emitPlaybackIssue = jest.fn();
    const session = new VjsMpegTsSession({
        player: () => ({ duration }),
        isLive: () => options.isLive ?? true,
        emitPlaybackIssue,
    });

    return { duration, emitPlaybackIssue, session };
}

function createMpegTsPlayer() {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    return {
        attachMediaElement: jest.fn(),
        load: jest.fn(),
        play: jest.fn(),
        pause: jest.fn(),
        unload: jest.fn(),
        detachMediaElement: jest.fn(),
        destroy: jest.fn(),
        on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
            const eventListeners =
                listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
            eventListeners.add(listener);
            listeners.set(event, eventListeners);
        }),
        off: jest.fn(
            (event: string, listener: (...args: unknown[]) => void) => {
                listeners.get(event)?.delete(listener);
            }
        ),
        emit: (event: string, ...args: unknown[]) => {
            for (const listener of listeners.get(event) ?? []) {
                listener(...args);
            }
        },
    };
}

function createTimeRanges(ranges: Array<[number, number]>): TimeRanges {
    return {
        length: ranges.length,
        start: (index: number) => ranges[index][0],
        end: (index: number) => ranges[index][1],
    } as TimeRanges;
}
