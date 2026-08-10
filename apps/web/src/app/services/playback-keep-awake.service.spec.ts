import { PlaybackKeepAwakeService } from './playback-keep-awake.service';

type ElectronWindow = Window & {
    electron?: { setPlaybackKeepAwake?: jest.Mock };
};

const flush = () => Promise.resolve().then(() => Promise.resolve());

describe('PlaybackKeepAwakeService', () => {
    let service: PlaybackKeepAwakeService;
    let video: HTMLVideoElement;
    let visibilityState: DocumentVisibilityState;

    const setVisibility = (state: DocumentVisibilityState) => {
        visibilityState = state;
        document.dispatchEvent(new Event('visibilitychange'));
    };

    beforeEach(() => {
        visibilityState = 'visible';
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => visibilityState,
        });
        service = new PlaybackKeepAwakeService();
        video = document.createElement('video');
        document.body.appendChild(video);
    });

    const setPictureInPictureElement = (element: Element | null) => {
        Object.defineProperty(document, 'pictureInPictureElement', {
            configurable: true,
            get: () => element,
        });
    };

    afterEach(() => {
        service.stop();
        video.remove();
        delete (window as ElectronWindow).electron;
        delete (document as { visibilityState?: unknown }).visibilityState;
        delete (document as { pictureInPictureElement?: unknown })
            .pictureInPictureElement;
    });

    describe('with the Electron bridge', () => {
        let setPlaybackKeepAwake: jest.Mock;

        beforeEach(() => {
            setPlaybackKeepAwake = jest.fn().mockResolvedValue(undefined);
            (window as ElectronWindow).electron = { setPlaybackKeepAwake };
            service.start();
        });

        it('activates on playing and releases on pause', () => {
            video.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(1);
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);

            video.dispatchEvent(new Event('pause'));
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(2);
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);
        });

        it.each(['ended', 'emptied', 'error'] as const)(
            'releases on %s',
            (eventType) => {
                video.dispatchEvent(new Event('playing'));
                video.dispatchEvent(new Event(eventType));
                expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);
            }
        );

        it('holds the lock until the last playing video stops', () => {
            const second = document.createElement('video');
            document.body.appendChild(second);

            video.dispatchEvent(new Event('playing'));
            second.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(1);

            video.dispatchEvent(new Event('pause'));
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(1);

            second.dispatchEvent(new Event('pause'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);
            second.remove();
        });

        it('does not react to repeated playing events of a tracked video', () => {
            video.dispatchEvent(new Event('playing'));
            video.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(1);
        });

        it('ignores audio elements so radio keeps the display free to sleep', () => {
            const audio = document.createElement('audio');
            document.body.appendChild(audio);

            audio.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).not.toHaveBeenCalled();
            audio.remove();
        });

        it('releases when a tracked video pauses after DOM removal', () => {
            video.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);

            // Chromium pauses removed media elements, but that pause fires on
            // the detached element and never reaches the document listener.
            video.remove();
            video.dispatchEvent(new Event('pause'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);
        });

        it('drops the lock while the document is hidden and re-acquires on return', () => {
            video.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);

            setVisibility('hidden');
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);

            setVisibility('visible');
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(3);
        });

        it('keeps the lock while a hidden window plays video in picture-in-picture', () => {
            video.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);

            setPictureInPictureElement(video);
            video.dispatchEvent(new Event('enterpictureinpicture'));
            setVisibility('hidden');

            // The PiP surface stays on screen after minimizing the window.
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(1);
        });

        it('releases the lock when PiP closes while the window is hidden', () => {
            video.dispatchEvent(new Event('playing'));
            setPictureInPictureElement(video);
            video.dispatchEvent(new Event('enterpictureinpicture'));
            setVisibility('hidden');
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);

            setPictureInPictureElement(null);
            video.dispatchEvent(new Event('leavepictureinpicture'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);
        });

        it('does not let a paused PiP video hold the lock', () => {
            video.dispatchEvent(new Event('playing'));
            setPictureInPictureElement(video);
            video.dispatchEvent(new Event('enterpictureinpicture'));
            setVisibility('hidden');

            video.dispatchEvent(new Event('pause'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);
        });

        it('retries after a failed IPC call on the next state change', async () => {
            setPlaybackKeepAwake.mockRejectedValueOnce(new Error('ipc down'));

            video.dispatchEvent(new Event('playing'));
            await flush();

            video.dispatchEvent(new Event('pause'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);
        });

        it('stop() releases the lock and detaches all listeners', () => {
            video.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(true);

            service.stop();
            expect(setPlaybackKeepAwake).toHaveBeenLastCalledWith(false);

            video.dispatchEvent(new Event('playing'));
            expect(setPlaybackKeepAwake).toHaveBeenCalledTimes(2);
        });
    });

    describe('with the Screen Wake Lock API (PWA)', () => {
        let request: jest.Mock;
        let release: jest.Mock;
        let sentinel: {
            release: jest.Mock;
            addEventListener: jest.Mock;
        };

        beforeEach(() => {
            release = jest.fn().mockResolvedValue(undefined);
            sentinel = { release, addEventListener: jest.fn() };
            request = jest.fn().mockResolvedValue(sentinel);
            Object.defineProperty(navigator, 'wakeLock', {
                configurable: true,
                value: { request },
            });
            service.start();
        });

        afterEach(() => {
            delete (navigator as { wakeLock?: unknown }).wakeLock;
        });

        it('requests a screen wake lock on playing and releases it on pause', async () => {
            video.dispatchEvent(new Event('playing'));
            expect(request).toHaveBeenCalledWith('screen');
            await flush();

            video.dispatchEvent(new Event('pause'));
            expect(release).toHaveBeenCalled();
        });

        it('releases a lock that resolves after playback already stopped', async () => {
            let resolveRequest:
                | ((value: typeof sentinel) => void)
                | undefined;
            request.mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveRequest = resolve;
                    })
            );

            video.dispatchEvent(new Event('playing'));
            video.dispatchEvent(new Event('pause'));
            resolveRequest?.(sentinel);
            await flush();

            expect(release).toHaveBeenCalled();
        });

        it('re-requests the lock after the browser auto-released it', async () => {
            video.dispatchEvent(new Event('playing'));
            await flush();

            // The browser releases the sentinel itself when the page hides.
            const onRelease = sentinel.addEventListener.mock.calls.find(
                ([type]) => type === 'release'
            )?.[1] as () => void;
            setVisibility('hidden');
            onRelease();

            setVisibility('visible');
            expect(request).toHaveBeenCalledTimes(2);
        });

        it('re-evaluates after a rejection that masked a state change', async () => {
            let rejectRequest: ((reason: Error) => void) | undefined;
            request.mockImplementationOnce(
                () =>
                    new Promise((_resolve, reject) => {
                        rejectRequest = reject;
                    })
            );

            video.dispatchEvent(new Event('playing'));
            // Hidden→visible round-trip while request() is still pending:
            // both sync() calls are swallowed by the in-flight guard, and
            // the pending request rejects because of the hidden moment.
            setVisibility('hidden');
            setVisibility('visible');
            rejectRequest?.(new Error('document was hidden'));
            await flush();

            // The masked state change must trigger a fresh request — the
            // video is still playing in a visible document.
            expect(request).toHaveBeenCalledTimes(2);
        });

        it('does not retry a plain rejection with no interleaved change', async () => {
            request.mockRejectedValueOnce(new Error('denied'));

            video.dispatchEvent(new Event('playing'));
            await flush();

            expect(request).toHaveBeenCalledTimes(1);
        });

        it('survives a denied wake lock request', async () => {
            request.mockRejectedValueOnce(new Error('denied'));

            video.dispatchEvent(new Event('playing'));
            await flush();

            // A later event retries.
            video.dispatchEvent(new Event('pause'));
            video.dispatchEvent(new Event('playing'));
            expect(request).toHaveBeenCalledTimes(2);
        });

        it('does nothing when the API is unavailable', () => {
            delete (navigator as { wakeLock?: unknown }).wakeLock;
            expect(() =>
                video.dispatchEvent(new Event('playing'))
            ).not.toThrow();
        });
    });
});
