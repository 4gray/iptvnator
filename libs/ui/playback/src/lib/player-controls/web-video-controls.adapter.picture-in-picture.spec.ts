import {
    PictureInPictureTestEnvironment,
    deferred,
} from './picture-in-picture.spec-helpers';
import { WebVideoControlsAdapter } from './web-video-controls.adapter';

const PICTURE_IN_PICTURE_WINDOW = {} as PictureInPictureWindow;

describe('WebVideoControlsAdapter Picture-in-Picture', () => {
    let adapter: WebVideoControlsAdapter;
    let environment: PictureInPictureTestEnvironment;

    beforeEach(() => {
        adapter = new WebVideoControlsAdapter();
        environment = new PictureInPictureTestEnvironment();
    });

    afterEach(() => {
        adapter.detach();
        environment.restore();
    });

    it('is unavailable when the document disables PiP', () => {
        environment.setEnabled(false);
        const video = installVideo();

        adapter.attach(video);

        expectPiP(false, false);
    });

    it('is unavailable when the element disables PiP', () => {
        const video = installVideo({ disablePictureInPicture: true });

        adapter.attach(video);

        expectPiP(false, false);
    });

    it('is unavailable without requestPictureInPicture', () => {
        const video = installVideo({ request: null });

        adapter.attach(video);

        expectPiP(false, false);
    });

    it('is unavailable without exitPictureInPicture', () => {
        environment.setExitAvailable(false);
        const video = installVideo();

        adapter.attach(video);

        expectPiP(false, false);
    });

    it('advertises support before metadata and enables entry after metadata', () => {
        const video = installVideo({ readyState: 0 });
        adapter.attach(video);

        expectPiP(true, false);

        environment.setReadyState(video, 1);
        video.dispatchEvent(new Event('loadedmetadata'));

        expectPiP(true, true);
    });

    it('requests entry synchronously and serializes the pending request', async () => {
        const pending = deferred<PictureInPictureWindow>();
        const video = installVideo({ request: () => pending.promise });
        const request = video.requestPictureInPicture as jest.MockedFunction<
            () => Promise<PictureInPictureWindow>
        >;
        adapter.attach(video);

        adapter.commands.togglePictureInPicture();
        adapter.commands.togglePictureInPicture();

        expect(request).toHaveBeenCalledTimes(1);
        expect(adapter.state().canPictureInPicture).toBe(false);

        pending.resolve(PICTURE_IN_PICTURE_WINDOW);
        await flushPromises();
        expect(adapter.state().canPictureInPicture).toBe(true);
    });

    it('uses browser events, not command optimism, as active authority', async () => {
        const pending = deferred<PictureInPictureWindow>();
        const video = installVideo({ request: () => pending.promise });
        adapter.attach(video);

        adapter.commands.togglePictureInPicture();
        expect(adapter.state().pictureInPictureActive).toBe(false);

        environment.setActive(video);
        expect(adapter.state().pictureInPictureActive).toBe(true);
        environment.setActive(null);
        expect(adapter.state().pictureInPictureActive).toBe(false);

        pending.resolve(PICTURE_IN_PICTURE_WINDOW);
        await flushPromises();
    });

    it('keeps owned exit available after entry support changes', () => {
        const video = installVideo();
        adapter.attach(video);
        environment.setActive(video);
        environment.setEnabled(false);
        environment.installVideo(video, {
            disablePictureInPicture: true,
            request: null,
        });
        adapter.refresh();

        expectPiP(true, true);
        adapter.commands.togglePictureInPicture();

        expect(environment.exit).toHaveBeenCalledTimes(1);
    });

    it('serializes a pending exit', async () => {
        const pending = deferred<void>();
        environment.exit.mockImplementation(() => pending.promise);
        const video = installVideo();
        adapter.attach(video);
        environment.setActive(video);

        adapter.commands.togglePictureInPicture();
        adapter.commands.togglePictureInPicture();

        expect(environment.exit).toHaveBeenCalledTimes(1);
        expect(adapter.state().canPictureInPicture).toBe(false);

        pending.resolve(undefined);
        await flushPromises();
        expect(adapter.state().canPictureInPicture).toBe(true);
    });

    it('fails closed when a PiP API property throws', () => {
        const video = installVideo();
        Object.defineProperty(video, 'disablePictureInPicture', {
            configurable: true,
            get: () => {
                throw new Error('PiP state unavailable');
            },
        });

        adapter.attach(video);

        expectPiP(false, false);
        expect(adapter.state().pictureInPictureActive).toBe(false);
    });

    it('contains a synchronous request throw and recovers the action', () => {
        const video = installVideo({
            request: () => {
                throw new Error('request failed');
            },
        });
        adapter.attach(video);

        expect(() => adapter.commands.togglePictureInPicture()).not.toThrow();
        expect(adapter.state().canPictureInPicture).toBe(true);
    });

    it('contains a rejected request and recovers the action', async () => {
        const video = installVideo({
            request: () => Promise.reject(new Error('request failed')),
        });
        adapter.attach(video);

        adapter.commands.togglePictureInPicture();
        await flushPromises();

        expect(adapter.state().canPictureInPicture).toBe(true);
    });

    it('contains a synchronous exit throw and recovers the action', () => {
        environment.exit.mockImplementation(() => {
            throw new Error('exit failed');
        });
        const video = installVideo();
        adapter.attach(video);
        environment.setActive(video);

        expect(() => adapter.commands.togglePictureInPicture()).not.toThrow();
        expect(adapter.state().canPictureInPicture).toBe(true);
    });

    it('contains a rejected exit and recovers the action', async () => {
        environment.exit.mockImplementation(() =>
            Promise.reject(new Error('exit failed'))
        );
        const video = installVideo();
        adapter.attach(video);
        environment.setActive(video);

        adapter.commands.togglePictureInPicture();
        await flushPromises();

        expect(adapter.state().canPictureInPicture).toBe(true);
    });

    it.each(['loadstart', 'emptied', 'loadedmetadata', 'refresh'] as const)(
        'preserves owned PiP across same-target %s invalidation',
        (eventName) => {
            const video = installVideo();
            adapter.attach(video);
            environment.setActive(video);

            if (eventName === 'refresh') {
                adapter.refresh();
            } else {
                video.dispatchEvent(new Event(eventName));
            }

            expect(environment.exit).not.toHaveBeenCalled();
            expect(adapter.state().pictureInPictureActive).toBe(true);
        }
    );

    it('exits exactly the owned old target once on replacement', () => {
        const owners: Element[] = [];
        environment.exit.mockImplementation(async () => {
            const owner = document.pictureInPictureElement;
            if (owner) {
                owners.push(owner);
            }
            environment.setActive(null);
        });
        const oldVideo = installVideo();
        const replacement = installVideo();
        adapter.attach(oldVideo);
        environment.setActive(oldVideo);

        adapter.attach(replacement);

        expect(environment.exit).toHaveBeenCalledTimes(1);
        expect(owners).toEqual([oldVideo]);
        expect(adapter.state().pictureInPictureActive).toBe(false);
    });

    it('never exits an unrelated PiP owner', () => {
        const video = installVideo();
        adapter.attach(video);
        environment.setActive(document.createElement('video'));

        adapter.detach();

        expect(environment.exit).not.toHaveBeenCalled();
    });

    it('makes repeated detach idempotent for owned PiP cleanup', () => {
        const video = installVideo();
        adapter.attach(video);
        environment.setActive(video);

        adapter.detach();
        adapter.detach();
        adapter.detach();

        expect(environment.exit).toHaveBeenCalledTimes(1);
    });

    it('ignores stale old-target events after replacement', () => {
        const oldVideo = installVideo();
        const replacement = installVideo();
        const refresh = jest.spyOn(adapter, 'refresh');
        adapter.attach(oldVideo);
        adapter.attach(replacement);
        refresh.mockClear();

        oldVideo.dispatchEvent(new Event('enterpictureinpicture'));

        expect(refresh).not.toHaveBeenCalled();
        expect(adapter.state().pictureInPictureActive).toBe(false);
    });

    it('cleans up a stale successful enter only when the old target owns PiP', async () => {
        const oldPending = deferred<PictureInPictureWindow>();
        const replacementPending = deferred<PictureInPictureWindow>();
        const owners: Element[] = [];
        environment.exit.mockImplementation(async () => {
            const owner = document.pictureInPictureElement;
            if (owner) {
                owners.push(owner);
            }
            environment.setActive(null);
        });
        const oldVideo = installVideo({ request: () => oldPending.promise });
        const replacement = installVideo({
            request: () => replacementPending.promise,
        });
        adapter.attach(oldVideo);
        adapter.commands.togglePictureInPicture();
        adapter.attach(replacement);
        adapter.commands.togglePictureInPicture();

        environment.setActive(oldVideo);
        oldPending.resolve(PICTURE_IN_PICTURE_WINDOW);
        await flushPromises();

        expect(environment.exit).toHaveBeenCalledTimes(1);
        expect(owners).toEqual([oldVideo]);
        expect(adapter.state().canPictureInPicture).toBe(false);

        replacementPending.resolve(PICTURE_IN_PICTURE_WINDOW);
        await flushPromises();
    });

    it('does not let a stale failure clear a newer pending operation', async () => {
        const oldPending = deferred<PictureInPictureWindow>();
        const replacementPending = deferred<PictureInPictureWindow>();
        const oldVideo = installVideo({ request: () => oldPending.promise });
        const replacement = installVideo({
            request: () => replacementPending.promise,
        });
        adapter.attach(oldVideo);
        adapter.commands.togglePictureInPicture();
        adapter.attach(replacement);
        adapter.commands.togglePictureInPicture();

        oldPending.reject(new Error('stale request failed'));
        await flushPromises();

        expect(environment.exit).not.toHaveBeenCalled();
        expect(adapter.state().canPictureInPicture).toBe(false);

        replacementPending.resolve(PICTURE_IN_PICTURE_WINDOW);
        await flushPromises();
        expect(adapter.state().canPictureInPicture).toBe(true);
    });

    it('reads PiP APIs from the video ownerDocument', () => {
        environment.setEnabled(false);
        const foreignDocument =
            document.implementation.createHTMLDocument('PiP');
        const foreignEnvironment = new PictureInPictureTestEnvironment(
            foreignDocument
        );
        const video = foreignDocument.createElement('video');
        foreignEnvironment.installVideo(video);

        try {
            adapter.attach(video);
            expectPiP(true, true);
        } finally {
            adapter.detach();
            foreignEnvironment.restore();
        }
    });

    function installVideo(
        options: Parameters<
            PictureInPictureTestEnvironment['installVideo']
        >[1] = {}
    ): HTMLVideoElement {
        const video = document.createElement('video');
        environment.installVideo(video, options);
        return video;
    }

    function expectPiP(supported: boolean, canToggle: boolean): void {
        expect(adapter.capabilities().pictureInPicture).toBe(supported);
        expect(adapter.state().canPictureInPicture).toBe(canToggle);
    }
});

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}
