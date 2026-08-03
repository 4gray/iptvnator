import { isBrowserMediaTypeSupported } from './browser-media-type-support';

describe('isBrowserMediaTypeSupported', () => {
    let mediaSourceDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
        mediaSourceDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'MediaSource'
        );
    });

    afterEach(() => {
        restoreMediaSource(mediaSourceDescriptor);
    });

    it('returns undefined when MediaSource is unavailable', () => {
        Reflect.deleteProperty(globalThis, 'MediaSource');

        expect(isBrowserMediaTypeSupported('video/mp4')).toBeUndefined();
    });

    it.each([undefined, null, true, {}])(
        'returns undefined when isTypeSupported is not callable: %p',
        (isTypeSupported) => {
            setMediaSource({ isTypeSupported });

            expect(isBrowserMediaTypeSupported('video/mp4')).toBeUndefined();
        }
    );

    it('returns undefined when the browser capability probe throws', () => {
        const providerMimeType =
            'video/mp4; codecs="provider-controlled-codec"';
        setMediaSource({
            isTypeSupported: () => {
                throw new Error(providerMimeType);
            },
        });

        expect(isBrowserMediaTypeSupported(providerMimeType)).toBeUndefined();
    });

    it.each([true, false])(
        'returns the browser capability result %s',
        (supportResult) => {
            const isTypeSupported = jest.fn(() => supportResult);
            setMediaSource({ isTypeSupported });

            expect(isBrowserMediaTypeSupported('video/mp4')).toBe(
                supportResult
            );
            expect(isTypeSupported).toHaveBeenCalledWith('video/mp4');
        }
    );
});

function setMediaSource(value: unknown): void {
    Object.defineProperty(globalThis, 'MediaSource', {
        configurable: true,
        value,
    });
}

function restoreMediaSource(descriptor?: PropertyDescriptor): void {
    if (descriptor) {
        Object.defineProperty(globalThis, 'MediaSource', descriptor);
        return;
    }
    Reflect.deleteProperty(globalThis, 'MediaSource');
}
