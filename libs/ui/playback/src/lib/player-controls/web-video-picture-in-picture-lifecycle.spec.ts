import { PictureInPictureTestEnvironment } from './picture-in-picture.spec-helpers';
import { releaseVideoPictureInPicture } from './web-video-picture-in-picture-lifecycle';

describe('released video PiP lifecycle', () => {
    let environment: PictureInPictureTestEnvironment;
    let video: HTMLVideoElement;

    beforeEach(() => {
        environment = new PictureInPictureTestEnvironment();
        video = document.createElement('video');
        environment.installVideo(video);
    });

    afterEach(() => environment.restore());

    it('releases an active owner only once', () => {
        environment.setActive(video);
        releaseVideoPictureInPicture(video);
        releaseVideoPictureInPicture(video);
        expect(environment.exit).toHaveBeenCalledTimes(1);
    });

    it('closes a vendor request that enters after its video was released', () => {
        releaseVideoPictureInPicture(video);
        expect(environment.exit).not.toHaveBeenCalled();
        environment.setActive(video);
        expect(environment.exit).toHaveBeenCalledTimes(1);
        expect(document.pictureInPictureElement).toBeNull();
    });

    it('does not close a different video, even on a stale old-video event', () => {
        releaseVideoPictureInPicture(video);
        const replacement = document.createElement('video');
        environment.setActive(replacement);
        video.dispatchEvent(new Event('enterpictureinpicture'));
        expect(environment.exit).not.toHaveBeenCalled();
        expect(document.pictureInPictureElement).toBe(replacement);
    });

    it('uses the video ownerDocument', () => {
        const foreignDocument = document.implementation.createHTMLDocument();
        const foreignEnvironment = new PictureInPictureTestEnvironment(
            foreignDocument
        );
        try {
            const foreignVideo = foreignDocument.createElement('video');
            foreignEnvironment.setActive(foreignVideo);
            releaseVideoPictureInPicture(foreignVideo);
            expect(foreignEnvironment.exit).toHaveBeenCalledTimes(1);
            expect(environment.exit).not.toHaveBeenCalled();
        } finally {
            foreignEnvironment.restore();
        }
    });

    it('returns an active WebKit PiP video to inline only once', () => {
        const webkit = installWebKitPresentation(video, 'picture-in-picture');
        releaseVideoPictureInPicture(video);
        releaseVideoPictureInPicture(video);
        expect(webkit.setMode).toHaveBeenCalledTimes(1);
        expect(webkit.setMode).toHaveBeenCalledWith('inline');
        expect(environment.exit).not.toHaveBeenCalled();
    });

    it('catches late WebKit PiP after unrelated presentation events', () => {
        const webkit = installWebKitPresentation(video, 'fullscreen');
        releaseVideoPictureInPicture(video);
        webkit.change('inline');
        expect(webkit.setMode).not.toHaveBeenCalled();
        webkit.change('picture-in-picture');
        expect(webkit.setMode).toHaveBeenCalledTimes(1);
        expect(webkit.setMode).toHaveBeenCalledWith('inline');
        // The retired-video listener is consumed by the first late PiP entry.
        webkit.change('picture-in-picture');
        expect(webkit.setMode).toHaveBeenCalledTimes(1);
    });

    it('leaves another WebKit video and standard PiP owner untouched', () => {
        const webkit = installWebKitPresentation(video, 'inline');
        const replacement = document.createElement('video');
        const nextWebkit = installWebKitPresentation(
            replacement,
            'picture-in-picture'
        );
        environment.setActive(replacement);
        releaseVideoPictureInPicture(video);
        webkit.change('fullscreen');
        expect(webkit.setMode).not.toHaveBeenCalled();
        expect(nextWebkit.setMode).not.toHaveBeenCalled();
        expect(environment.exit).not.toHaveBeenCalled();
        expect(document.pictureInPictureElement).toBe(replacement);
    });

    it('contains WebKit exit errors while still releasing standard PiP', () => {
        const webkit = installWebKitPresentation(video, 'picture-in-picture');
        webkit.setMode.mockImplementation(() => {
            throw new Error('WebKit exit failed');
        });
        environment.setActive(video);
        expect(() => releaseVideoPictureInPicture(video)).not.toThrow();
        expect(webkit.setMode).toHaveBeenCalledWith('inline');
        expect(environment.exit).toHaveBeenCalledTimes(1);
    });

    it('allows teardown without a video or an exit API', () => {
        environment.setActive(video);
        environment.setExitAvailable(false);
        expect(() => releaseVideoPictureInPicture(null)).not.toThrow();
        expect(() => releaseVideoPictureInPicture(video)).not.toThrow();
    });

    it.each(['throw', 'reject'])('contains an exit API %s', async (failure) => {
        environment.setActive(video);
        environment.exit.mockImplementation(() => {
            if (failure === 'throw') throw new Error('PiP exit failed');
            return Promise.reject(new Error('PiP exit failed'));
        });
        expect(() => releaseVideoPictureInPicture(video)).not.toThrow();
        await Promise.resolve();
    });
});

function installWebKitPresentation(video: HTMLVideoElement, initial: string) {
    let mode = initial;
    const change = (next: string) => {
        mode = next;
        video.dispatchEvent(new Event('webkitpresentationmodechanged'));
    };
    const setMode = jest.fn(change);
    Object.defineProperties(video, {
        webkitPresentationMode: { get: () => mode },
        webkitSetPresentationMode: { value: setMode },
    });
    return { change, setMode };
}
