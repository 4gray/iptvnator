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
            showCaptions: () => true,
            sharedControls: () => false,
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

    it('suppresses legacy captions only after successful non-shared playback', async () => {
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
        const session = createSession(video, {
            showCaptions: () => false,
            sharedControls: () => false,
        });

        session.play();
        await Promise.resolve();

        expect(tracks.map((track) => track.mode)).toEqual(['hidden', 'hidden']);
    });

    it.each([
        { showCaptions: true, sharedControls: false },
        { showCaptions: false, sharedControls: true },
    ])(
        'keeps captions when showCaptions=$showCaptions and sharedControls=$sharedControls',
        async ({ showCaptions, sharedControls }) => {
            const video = document.createElement('video');
            const tracks = [{ mode: 'showing' as TextTrackMode }];
            Object.defineProperty(video, 'textTracks', {
                configurable: true,
                value: tracks,
            });
            jest.spyOn(video, 'play').mockResolvedValue(undefined);
            const session = createSession(video, {
                showCaptions: () => showCaptions,
                sharedControls: () => sharedControls,
            });

            session.play();
            await Promise.resolve();

            expect(tracks[0].mode).toBe('showing');
        }
    );
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
        showCaptions: () => true,
        sharedControls: () => false,
        emitPlaybackIssue: jest.fn(),
        emitTimeUpdate: jest.fn(),
        emitPlaybackEnded: jest.fn(),
        ...overrides,
    });
}
