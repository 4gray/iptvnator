const HAVE_METADATA = 1;
const PICTURE_IN_PICTURE_ACTION = {
    ENTER: 'enter',
    EXIT: 'exit',
} as const;

type PictureInPictureAction =
    (typeof PICTURE_IN_PICTURE_ACTION)[keyof typeof PICTURE_IN_PICTURE_ACTION];

interface PictureInPictureOperation {
    readonly action: PictureInPictureAction;
    readonly generation: number;
    readonly video: HTMLVideoElement;
}

export interface WebVideoPictureInPictureBinding {
    readonly generation: number;
    readonly video: HTMLVideoElement | null;
}

export interface WebVideoPictureInPictureSnapshot {
    readonly active: boolean;
    readonly canExit: boolean;
    readonly canRequest: boolean;
    readonly canToggle: boolean;
    readonly supported: boolean;
}

const EMPTY_PICTURE_IN_PICTURE_SNAPSHOT: WebVideoPictureInPictureSnapshot = {
    active: false,
    canExit: false,
    canRequest: false,
    canToggle: false,
    supported: false,
};

export class WebVideoPictureInPictureController {
    private operation: PictureInPictureOperation | null = null;

    constructor(
        private readonly readBinding: () => WebVideoPictureInPictureBinding,
        private readonly refresh: () => void
    ) {}

    release(previousVideo: HTMLVideoElement | null): void {
        this.operation = null;
        if (previousVideo) {
            this.exitIfOwned(previousVideo);
        }
    }

    snapshot(): WebVideoPictureInPictureSnapshot {
        const video = this.readBinding().video;
        if (!video) {
            return EMPTY_PICTURE_IN_PICTURE_SNAPSHOT;
        }

        return this.readSnapshot(video);
    }

    toggle(): void {
        const binding = this.readBinding();
        const video = binding.video;
        if (!video || this.operation) {
            return;
        }

        const snapshot = this.readSnapshot(video);
        if (!snapshot.canToggle) {
            return;
        }
        if (snapshot.active && snapshot.canExit) {
            this.startOperation(PICTURE_IN_PICTURE_ACTION.EXIT, binding, () =>
                video.ownerDocument.exitPictureInPicture()
            );
            return;
        }
        if (snapshot.canRequest) {
            this.startOperation(PICTURE_IN_PICTURE_ACTION.ENTER, binding, () =>
                video.requestPictureInPicture()
            );
        }
    }

    private readSnapshot(
        video: HTMLVideoElement
    ): WebVideoPictureInPictureSnapshot {
        try {
            const ownerDocument = video.ownerDocument;
            const active = ownerDocument.pictureInPictureElement === video;
            const canExit =
                typeof ownerDocument.exitPictureInPicture === 'function';
            const canRequest =
                ownerDocument.pictureInPictureEnabled === true &&
                typeof video.requestPictureInPicture === 'function' &&
                canExit &&
                video.disablePictureInPicture !== true;
            return {
                active,
                canExit,
                canRequest,
                canToggle:
                    this.operation === null &&
                    ((active && canExit) ||
                        (canRequest && video.readyState >= HAVE_METADATA)),
                supported: canRequest || (active && canExit),
            };
        } catch {
            return EMPTY_PICTURE_IN_PICTURE_SNAPSHOT;
        }
    }

    private startOperation(
        action: PictureInPictureAction,
        binding: WebVideoPictureInPictureBinding,
        invoke: () => Promise<unknown>
    ): void {
        const video = binding.video;
        if (!video) {
            return;
        }
        const operation: PictureInPictureOperation = {
            action,
            generation: binding.generation,
            video,
        };
        this.operation = operation;
        this.refresh();

        let result: Promise<unknown>;
        try {
            result = invoke();
        } catch {
            this.settleOperation(operation, false);
            return;
        }
        void Promise.resolve(result).then(
            () => this.settleOperation(operation, true),
            () => this.settleOperation(operation, false)
        );
    }

    private settleOperation(
        operation: PictureInPictureOperation,
        succeeded: boolean
    ): void {
        const binding = this.readBinding();
        const isCurrent =
            this.operation === operation &&
            binding.generation === operation.generation &&
            binding.video === operation.video;
        if (isCurrent) {
            this.operation = null;
            this.refresh();
            return;
        }
        if (succeeded && operation.action === PICTURE_IN_PICTURE_ACTION.ENTER) {
            this.exitIfOwned(operation.video);
        }
    }

    private exitIfOwned(video: HTMLVideoElement): void {
        try {
            const ownerDocument = video.ownerDocument;
            if (
                ownerDocument.pictureInPictureElement !== video ||
                typeof ownerDocument.exitPictureInPicture !== 'function'
            ) {
                return;
            }
            const result = ownerDocument.exitPictureInPicture();
            void Promise.resolve(result).then(
                () => undefined,
                () => undefined
            );
        } catch {
            // PiP teardown is best-effort during target replacement.
        }
    }
}
