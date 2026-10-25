import { DestroyRef } from '@angular/core';
import { createScrollPositionPreserver } from './create-scroll-position-preserver';

describe('createScrollPositionPreserver', () => {
    let callbacks: Map<number, FrameRequestCallback>;
    let destroy: () => void;
    let preserver: ReturnType<typeof createScrollPositionPreserver>;
    let container: HTMLElement;

    beforeEach(() => {
        callbacks = new Map();
        let nextFrame = 0;
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation(
            (callback) => {
                callbacks.set(++nextFrame, callback);
                return nextFrame;
            }
        );
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(
            (frame) => {
                callbacks.delete(frame);
            }
        );
        preserver = createScrollPositionPreserver({
            onDestroy: (callback) => {
                destroy = callback;
                return () => undefined;
            },
        } as DestroyRef);
        container = document.createElement('div');
        container.scrollTo = jest.fn((options?: ScrollToOptions | number) => {
            container.scrollTop =
                typeof options === 'object' ? (options.top ?? 0) : 0;
        });
    });

    afterEach(() => jest.restoreAllMocks());

    function flushFrames(): void {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach((callback) => callback(0));
    }

    it('restores the clicked position after a pending compositor update', () => {
        container.scrollTop = 92;
        preserver.preserve(container);
        // Chromium can apply this final update after the immediate abort.
        container.scrollTop = 134;
        flushFrames();
        expect(container.scrollTop).toBe(92);
    });

    it('does not overwrite a later reveal after cancellation', () => {
        container.scrollTop = 92;
        preserver.preserve(container);
        preserver.cancel();
        container.scrollTop = 800;
        flushFrames();
        expect(container.scrollTop).toBe(800);
    });

    it('keeps only the latest preserved position', () => {
        container.scrollTop = 92;
        preserver.preserve(container);
        container.scrollTop = 120;
        preserver.preserve(container);
        container.scrollTop = 134;
        flushFrames();
        expect(container.scrollTop).toBe(120);
    });

    it('cancels a pending restoration when its component is destroyed', () => {
        container.scrollTop = 92;
        preserver.preserve(container);
        destroy();
        container.scrollTop = 134;
        flushFrames();
        expect(container.scrollTop).toBe(134);
    });
});
