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
