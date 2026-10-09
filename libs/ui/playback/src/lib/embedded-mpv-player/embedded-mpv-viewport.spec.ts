import {
    clipBoundsToViewport,
    measureNativeViewport,
} from './embedded-mpv-viewport';

describe('native video scroll clipping', () => {
    const bounds = { x: 20, y: -40, width: 640, height: 360 };
    it('clips behind the header without shifting or shrinking video', () => {
        expect(
            clipBoundsToViewport(bounds, {
                left: 0,
                top: 64,
                right: 800,
                bottom: 600,
            })
        ).toEqual({
            ...bounds,
            clipInsetLeft: 0,
            clipInsetTop: 104,
            clipInsetRight: 0,
            clipInsetBottom: 0,
        });
    });
    it('clips all edges of a nested viewport', () => {
        expect(
            clipBoundsToViewport(bounds, {
                left: 80,
                top: 64,
                right: 600,
                bottom: 280,
            })
        ).toEqual({
            ...bounds,
            clipInsetLeft: 60,
            clipInsetTop: 104,
            clipInsetRight: 60,
            clipInsetBottom: 40,
        });
    });
    it('produces an empty drawing region when entirely scrolled away', () => {
        expect(
            clipBoundsToViewport(bounds, {
                left: 0,
                top: 400,
                right: 800,
                bottom: 600,
            }).clipInsetTop
        ).toBe(360);
    });

    it('measures scroll ancestors and ignores them when the video is fullscreen', () => {
        const scroller = document.createElement('div');
        const host = document.createElement('div');
        scroller.style.overflow = 'auto';
        scroller.style.overflowX = 'auto';
        scroller.style.overflowY = 'auto';
        scroller.append(host);
        document.body.append(scroller);
        jest.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 64,
            width: 800,
            height: 500,
        } as DOMRect);
        jest.spyOn(host, 'getBoundingClientRect').mockReturnValue({
            left: 20,
            top: 0,
            width: 640,
            height: 360,
        } as DOMRect);
        Object.defineProperty(scroller, 'clientWidth', { value: 800 });
        Object.defineProperty(scroller, 'clientHeight', { value: 500 });
        expect(measureNativeViewport(host).clipInsetTop).toBe(64);
        const previous = Object.getOwnPropertyDescriptor(
            document,
            'fullscreenElement'
        );
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            value: host,
        });
        try {
            expect(measureNativeViewport(host).clipInsetTop).toBe(0);
        } finally {
            if (previous)
                Object.defineProperty(document, 'fullscreenElement', previous);
            else
                delete (document as unknown as { fullscreenElement?: Element })
                    .fullscreenElement;
            scroller.remove();
        }
    });
});
