import { WebVideoControlsAdapter } from './web-video-controls.adapter';

function createPausedVideo(readyState: number): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperties(video, {
        paused: {
            configurable: true,
            value: true,
        },
        readyState: {
            configurable: true,
            value: readyState,
        },
    });
    return video;
}

describe('WebVideoControlsAdapter media events', () => {
    let adapter: WebVideoControlsAdapter;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
    });

    afterEach(() => adapter.detach());

    it.each([
        ['loadeddata', 2],
        ['canplay', 3],
    ] as const)(
        'refreshes a cached paused loading state on %s',
        (eventName, readyState) => {
            const video = createPausedVideo(1);
            adapter.attach(video, { isLive: () => false });
            expect(adapter.state().status).toBe('loading');

            Object.defineProperty(video, 'readyState', {
                configurable: true,
                value: readyState,
            });
            video.dispatchEvent(new Event(eventName));

            expect(adapter.state().status).toBe('paused');
        }
    );
});
