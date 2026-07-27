export interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(reason?: unknown): void;
}

export interface PictureInPictureVideoOptions {
    readonly disablePictureInPicture?: boolean;
    readonly readyState?: number;
    readonly request?: PictureInPictureRequest | null;
}

type PictureInPictureRequest = () => Promise<PictureInPictureWindow>;

interface VideoPropertyDescriptors {
    readonly disablePictureInPicture: PropertyDescriptor | undefined;
    readonly readyState: PropertyDescriptor | undefined;
    readonly requestPictureInPicture: PropertyDescriptor | undefined;
}

export function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

export class PictureInPictureTestEnvironment {
    private activeElement: Element | null = null;
    private enabled = true;
    private readonly enabledDescriptor: PropertyDescriptor | undefined;
    private readonly elementDescriptor: PropertyDescriptor | undefined;
    private readonly exitDescriptor: PropertyDescriptor | undefined;
    private readonly videoDescriptors = new Map<
        HTMLVideoElement,
        VideoPropertyDescriptors
    >();

    readonly exit: jest.MockedFunction<() => Promise<void>> = jest.fn(
        async () => {
            this.setActive(null);
        }
    );

    constructor(private readonly ownerDocument: Document = document) {
        this.enabledDescriptor = Object.getOwnPropertyDescriptor(
            ownerDocument,
            'pictureInPictureEnabled'
        );
        this.elementDescriptor = Object.getOwnPropertyDescriptor(
            ownerDocument,
            'pictureInPictureElement'
        );
        this.exitDescriptor = Object.getOwnPropertyDescriptor(
            ownerDocument,
            'exitPictureInPicture'
        );
        Object.defineProperty(ownerDocument, 'pictureInPictureEnabled', {
            configurable: true,
            get: () => this.enabled,
        });
        Object.defineProperty(ownerDocument, 'pictureInPictureElement', {
            configurable: true,
            get: () => this.activeElement,
        });
        this.setExitAvailable(true);
    }

    installVideo(
        video: HTMLVideoElement,
        options: PictureInPictureVideoOptions = {}
    ): jest.MockedFunction<PictureInPictureRequest> | null {
        this.assertOwnerDocument(video);
        this.captureVideoDescriptors(video);
        this.setReadyState(video, options.readyState ?? 1);
        this.setDisablePictureInPicture(
            video,
            options.disablePictureInPicture ?? false
        );

        if (options.request === null) {
            Object.defineProperty(video, 'requestPictureInPicture', {
                configurable: true,
                value: undefined,
            });
            return null;
        }

        const request =
            options.request ??
            (async () => {
                this.setActive(video);
                return {} as PictureInPictureWindow;
            });
        const requestMock: jest.MockedFunction<PictureInPictureRequest> =
            jest.fn(request);
        Object.defineProperty(video, 'requestPictureInPicture', {
            configurable: true,
            value: requestMock,
        });
        return requestMock;
    }

    setActive(element: Element | null, emit = true): void {
        const previous = this.activeElement;
        this.activeElement = element;
        if (!emit || previous === element) {
            return;
        }
        previous?.dispatchEvent(new Event('leavepictureinpicture'));
        element?.dispatchEvent(new Event('enterpictureinpicture'));
    }

    setDisablePictureInPicture(video: HTMLVideoElement, value: boolean): void {
        this.assertOwnerDocument(video);
        this.captureVideoDescriptors(video);
        Object.defineProperty(video, 'disablePictureInPicture', {
            configurable: true,
            writable: true,
            value,
        });
    }

    setEnabled(value: boolean): void {
        this.enabled = value;
    }

    setExitAvailable(value: boolean): void {
        Object.defineProperty(this.ownerDocument, 'exitPictureInPicture', {
            configurable: true,
            value: value ? this.exit : undefined,
        });
    }

    setReadyState(video: HTMLVideoElement, value: number): void {
        this.assertOwnerDocument(video);
        this.captureVideoDescriptors(video);
        Object.defineProperty(video, 'readyState', {
            configurable: true,
            value,
        });
    }

    restore(): void {
        for (const [video, descriptors] of this.videoDescriptors) {
            this.restoreProperty(
                video,
                'disablePictureInPicture',
                descriptors.disablePictureInPicture
            );
            this.restoreProperty(video, 'readyState', descriptors.readyState);
            this.restoreProperty(
                video,
                'requestPictureInPicture',
                descriptors.requestPictureInPicture
            );
        }
        this.videoDescriptors.clear();
        this.restoreProperty(
            this.ownerDocument,
            'pictureInPictureEnabled',
            this.enabledDescriptor
        );
        this.restoreProperty(
            this.ownerDocument,
            'pictureInPictureElement',
            this.elementDescriptor
        );
        this.restoreProperty(
            this.ownerDocument,
            'exitPictureInPicture',
            this.exitDescriptor
        );
    }

    private assertOwnerDocument(video: HTMLVideoElement): void {
        if (video.ownerDocument !== this.ownerDocument) {
            throw new Error('PiP test video belongs to a different document');
        }
    }

    private captureVideoDescriptors(video: HTMLVideoElement): void {
        if (this.videoDescriptors.has(video)) {
            return;
        }
        this.videoDescriptors.set(video, {
            disablePictureInPicture: Object.getOwnPropertyDescriptor(
                video,
                'disablePictureInPicture'
            ),
            readyState: Object.getOwnPropertyDescriptor(video, 'readyState'),
            requestPictureInPicture: Object.getOwnPropertyDescriptor(
                video,
                'requestPictureInPicture'
            ),
        });
    }

    private restoreProperty(
        target: object,
        property: string,
        descriptor: PropertyDescriptor | undefined
    ): void {
        if (descriptor) {
            Object.defineProperty(target, property, descriptor);
            return;
        }
        delete (target as Record<string, unknown>)[property];
    }
}
