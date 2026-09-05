const releasedVideos = new WeakSet<HTMLVideoElement>();

interface WebKitPictureInPictureVideo extends HTMLVideoElement {
    readonly webkitPresentationMode?: string;
    webkitSetPresentationMode?: (mode: 'inline') => void;
}

/** Release a legacy/native video that will never be used by this host again. */
export function releaseVideoPictureInPicture(
    video: HTMLVideoElement | null | undefined
): void {
    if (!video || releasedVideos.has(video)) {
        return;
    }
    releasedVideos.add(video);
    // Vendor/native entry requests are not owned by the shared controller.
    // A pending request can enter after teardown. Keep a one-shot listener on
    // only the retired video, with no timer, document listener, or host capture.
    video.addEventListener(
        'enterpictureinpicture',
        () => exitOwnedPictureInPicture(video),
        { once: true }
    );
    exitOwnedPictureInPicture(video);
    releaseWebKitPictureInPicture(video);
}

function releaseWebKitPictureInPicture(
    video: WebKitPictureInPictureVideo
): void {
    if (typeof video.webkitSetPresentationMode !== 'function') return;
    // WebKit uses one event for inline, fullscreen, and PiP. Only consume the
    // retired-video listener when a late PiP entry actually arrives.
    const onPresentationChange = () => {
        if (video.webkitPresentationMode !== 'picture-in-picture') return;
        video.removeEventListener(
            'webkitpresentationmodechanged',
            onPresentationChange
        );
        exitWebKitPictureInPicture(video);
    };
    video.addEventListener(
        'webkitpresentationmodechanged',
        onPresentationChange
    );
    exitWebKitPictureInPicture(video);
}

function exitWebKitPictureInPicture(video: WebKitPictureInPictureVideo): void {
    try {
        if (video.webkitPresentationMode === 'picture-in-picture') {
            video.webkitSetPresentationMode?.('inline');
        }
    } catch {
        // WebKit's synchronous API can reject presentation changes at teardown.
    }
}

export function exitOwnedPictureInPicture(video: HTMLVideoElement): void {
    try {
        const ownerDocument = video.ownerDocument;
        if (
            ownerDocument.pictureInPictureElement !== video ||
            typeof ownerDocument.exitPictureInPicture !== 'function'
        ) {
            return;
        }
        void Promise.resolve(ownerDocument.exitPictureInPicture()).then(
            () => undefined,
            () => undefined
        );
    } catch {
        // PiP teardown is best-effort during target replacement.
    }
}
