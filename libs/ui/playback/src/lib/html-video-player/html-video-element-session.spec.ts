import { HtmlVideoElementSession } from './html-video-element-session';

describe('HtmlVideoElementSession', () => {
    it('owns native video events and detaches them idempotently', () => {
        const video = document.createElement('video');
        const playbackIssues: unknown[] = [];
        const timeUpdates: Array<{ currentTime: number; duration: number }> =
            [];
        const playbackEnded = jest.fn();
        const removeEventListener = jest.spyOn(video, 'removeEventListener');
        const session = new HtmlVideoElementSession({
            video,
            getChannelUrl: () => 'https://example.test/video.ts',
            getStartTime: () => 12,
            emitPlaybackIssue: (issue) => playbackIssues.push(issue),
            emitTimeUpdate: (value) => timeUpdates.push(value),
            emitPlaybackEnded: playbackEnded,
        });
        Object.defineProperty(video, 'duration', {
            configurable: true,
            value: 90,
        });
        Object.defineProperty(video, 'error', {
            configurable: true,
            value: {
                code: 4,
                message: 'No compatible source was found',
            },
        });

        session.attach();
        session.attach();
        video.dispatchEvent(new Event('loadedmetadata'));
        expect(video.currentTime).toBe(12);
        video.currentTime = 18;
        video.dispatchEvent(new Event('timeupdate'));
        video.dispatchEvent(new Event('error'));
        video.dispatchEvent(new Event('loadeddata'));
        video.dispatchEvent(new Event('playing'));
        video.dispatchEvent(new Event('ended'));

        expect(video.currentTime).toBe(18);
        expect(timeUpdates).toEqual([{ currentTime: 18, duration: 90 }]);
        expect(playbackIssues[0]).toEqual(
            expect.objectContaining({
                code: 'unsupported-container',
                source: 'native',
                sourceUrl: 'https://example.test/video.ts',
            })
        );
        expect(playbackIssues.slice(1)).toEqual([null, null]);
        expect(playbackEnded).toHaveBeenCalledTimes(1);

        session.destroy();
        session.destroy();
        video.dispatchEvent(new Event('ended'));

        expect(playbackEnded).toHaveBeenCalledTimes(1);
        expect(removeEventListener).toHaveBeenCalledTimes(7);
    });

    it('persists volume changes from the native video element', () => {
        const video = document.createElement('video');
        video.volume = 0.35;
        const session = createSession(video);
        localStorage.removeItem('volume');

        session.attach();
        video.dispatchEvent(new Event('volumechange'));

        expect(localStorage.getItem('volume')).toBe('0.35');
        session.destroy();
    });

    // Caption state belongs to WebVideoSourceTracks, which follows the active
    // source engine. The old play()-time one-shot ran before hls.js had added
    // its text tracks, which is what made the preference look like a no-op.
    it('leaves text tracks alone when playback starts', async () => {
        const video = document.createElement('video');
        const tracks = [
            { mode: 'showing' as TextTrackMode },
            { mode: 'showing' as TextTrackMode },
        ];
        Object.defineProperty(video, 'textTracks', {
            configurable: true,
            value: tracks,
        });
        jest.spyOn(video, 'play').mockResolvedValue(undefined);
        const session = createSession(video);

        session.play();
        await Promise.resolve();

        expect(tracks.map((track) => track.mode)).toEqual([
            'showing',
            'showing',
        ]);
    });

    it('swallows autoplay rejections', async () => {
        const video = document.createElement('video');
        jest.spyOn(video, 'play').mockRejectedValue(
            new Error('autoplay blocked')
        );
        const session = createSession(video);

        expect(() => session.play()).not.toThrow();
        await Promise.resolve();
    });
});

function createSession(
    video: HTMLVideoElement,
    overrides: Partial<
        ConstructorParameters<typeof HtmlVideoElementSession>[0]
    > = {}
): HtmlVideoElementSession {
    return new HtmlVideoElementSession({
        video,
        getChannelUrl: () => undefined,
        getStartTime: () => 0,
        emitPlaybackIssue: jest.fn(),
        emitTimeUpdate: jest.fn(),
        emitPlaybackEnded: jest.fn(),
        ...overrides,
    });
}
