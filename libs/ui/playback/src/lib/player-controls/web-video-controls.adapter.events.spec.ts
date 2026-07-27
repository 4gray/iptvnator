import { WebVideoControlsAdapter } from './web-video-controls.adapter';

interface VideoOverrides {
    duration: number;
    readyState: number;
    networkState: number;
    paused: boolean;
    currentTime: number;
    seekableLength: number;
}

function createVideo(
    overrides: Partial<VideoOverrides> = {}
): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperties(video, {
        duration: {
            configurable: true,
            writable: true,
            value: overrides.duration ?? 120,
        },
        paused: {
            configurable: true,
            writable: true,
            value: overrides.paused ?? true,
        },
        readyState: {
            configurable: true,
            writable: true,
            value: overrides.readyState ?? 1,
        },
        networkState: {
            configurable: true,
            writable: true,
            value: overrides.networkState ?? 1,
        },
        currentTime: {
            configurable: true,
            writable: true,
            value: overrides.currentTime ?? 0,
        },
        seekable: {
            configurable: true,
            writable: true,
            value: { length: overrides.seekableLength ?? 0 },
        },
    });
    return video;
}

function setMediaProp(
    video: HTMLVideoElement,
    property: string,
    value: unknown
): void {
    Object.defineProperty(video, property, {
        configurable: true,
        writable: true,
        value,
    });
}

describe('WebVideoControlsAdapter media events', () => {
    let adapter: WebVideoControlsAdapter;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
    });

    afterEach(() => adapter.detach());

    it.each(['loadedmetadata', 'loadeddata', 'canplay'] as const)(
        'retains readiness invalidation on %s',
        (eventName) => {
            const video = createVideo({ duration: NaN });
            adapter.attach(video, { isLive: () => false });
            expect(adapter.state().durationSeconds).toBeNull();

            setMediaProp(video, 'duration', 120);
            video.dispatchEvent(new Event(eventName));

            expect(adapter.state().durationSeconds).toBe(120);
        }
    );

    it('clears cached resource state when emptied fires', () => {
        const video = createVideo({
            duration: 120,
            readyState: 4,
            networkState: 1,
            currentTime: 30,
            seekableLength: 1,
        });
        adapter.attach(video, { isLive: () => false });
        expect(adapter.state().durationSeconds).toBe(120);
        expect(adapter.state().canSeek).toBe(true);

        setMediaProp(video, 'duration', NaN);
        setMediaProp(video, 'readyState', 0);
        setMediaProp(video, 'networkState', 0);
        setMediaProp(video, 'currentTime', 0);
        setMediaProp(video, 'seekable', { length: 0 });
        video.dispatchEvent(new Event('emptied'));

        expect(adapter.state().status).toBe('idle');
        expect(adapter.state().durationSeconds).toBeNull();
        expect(adapter.state().positionSeconds).toBe(0);
        expect(adapter.state().canSeek).toBe(false);
    });

    it('updates paused VOD seekability when progress fires', () => {
        const video = createVideo({
            duration: 120,
            paused: true,
            seekableLength: 0,
        });
        adapter.attach(video, { isLive: () => false });
        expect(adapter.state().canSeek).toBe(false);

        setMediaProp(video, 'seekable', { length: 1 });
        video.dispatchEvent(new Event('progress'));

        expect(adapter.state().canSeek).toBe(true);
    });

    it.each(['loadstart', 'stalled', 'seeking', 'seeked'] as const)(
        'invalidates cached media state on %s',
        (eventName) => {
            const video = createVideo({ currentTime: 0 });
            adapter.attach(video, { isLive: () => false });
            expect(adapter.state().positionSeconds).toBe(0);

            setMediaProp(video, 'currentTime', 15);
            video.dispatchEvent(new Event(eventName));

            expect(adapter.state().positionSeconds).toBe(15);
        }
    );
});
