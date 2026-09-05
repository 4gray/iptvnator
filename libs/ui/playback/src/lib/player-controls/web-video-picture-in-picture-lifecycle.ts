const releasedVideos = new WeakSet<HTMLVideoElement>();

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
