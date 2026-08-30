import { ControlsSurface } from './controls-surface';

/** jsdom has no PointerEvent; a MouseEvent with a pointerType matches how the
 * surface reads events (it only inspects the property). */
function pointerTypedEvent(type: string, pointerType: string): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
}

describe('ControlsSurface', () => {
    let reveal: jest.Mock;
    let toggleFullscreen: jest.Mock;
    let closePopovers: jest.Mock;
    let togglePlay: jest.Mock;
    let hideControls: jest.Mock;
    let canTogglePlay: boolean;
    let menuOpen: boolean;
    let controlsVisible: boolean;
    let surface: ControlsSurface;
    let element: HTMLElement;

    beforeEach(() => {
        reveal = jest.fn();
        toggleFullscreen = jest.fn();
        closePopovers = jest.fn();
        togglePlay = jest.fn();
        hideControls = jest.fn();
        canTogglePlay = true;
        menuOpen = false;
        controlsVisible = true;
        element = document.createElement('div');
        document.body.appendChild(element);
        surface = new ControlsSurface({
            reveal,
            toggleFullscreen,
            closePopovers,
            togglePlay,
            canTogglePlay: () => canTogglePlay,
            isMenuOpen: () => menuOpen,
            controlsVisible: () => controlsVisible,
            hideControls,
        });
    });

    afterEach(() => {
        surface.dispose();
        element.remove();
        jest.useRealTimers();
    });

    it('reveals on pointer activity over the surface', () => {
        surface.attachSurface(element);
        element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(reveal).toHaveBeenCalledTimes(2);
    });

    it('toggles fullscreen on a double-click outside interactive elements', () => {
        surface.attachSurface(element);
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(toggleFullscreen).toHaveBeenCalledTimes(1);
    });

    it('ignores double-clicks on buttons/inputs/sliders', () => {
        const button = document.createElement('button');
        element.appendChild(button);
        surface.attachSurface(element);
        button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(toggleFullscreen).not.toHaveBeenCalled();
    });

    it('toggles play on a single click after the defer delay', () => {
        jest.useFakeTimers();
        surface.attachSurface(element);
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(togglePlay).not.toHaveBeenCalled();
        jest.advanceTimersByTime(300);
        expect(togglePlay).toHaveBeenCalledTimes(1);
    });

    it('does not queue play while toggling is unavailable', () => {
        jest.useFakeTimers();
        canTogglePlay = false;
        surface.attachSurface(element);
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        canTogglePlay = true;
        jest.advanceTimersByTime(300);

        expect(togglePlay).not.toHaveBeenCalled();
    });

    it('does not toggle play on a double-click, only fullscreens', () => {
        jest.useFakeTimers();
        surface.attachSurface(element);
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        jest.advanceTimersByTime(300);
        expect(togglePlay).not.toHaveBeenCalled();
        expect(toggleFullscreen).toHaveBeenCalledTimes(1);
    });

    it('does not toggle play on a click on a button', () => {
        jest.useFakeTimers();
        const button = document.createElement('button');
        element.appendChild(button);
        surface.attachSurface(element);
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        jest.advanceTimersByTime(300);
        expect(togglePlay).not.toHaveBeenCalled();
    });

    it('ignores clicks and double-clicks from the controls root', () => {
        jest.useFakeTimers();
        surface.dispose();
        const controlsRoot = document.createElement('div');
        const timeLabel = document.createElement('span');
        controlsRoot.appendChild(timeLabel);
        element.appendChild(controlsRoot);
        surface = new ControlsSurface(
            {
                reveal,
                toggleFullscreen,
                closePopovers,
                togglePlay,
                canTogglePlay: () => canTogglePlay,
                isMenuOpen: () => menuOpen,
            },
            controlsRoot
        );
        surface.attachSurface(element);

        timeLabel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        jest.advanceTimersByTime(300);
        expect(togglePlay).not.toHaveBeenCalled();

        timeLabel.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(toggleFullscreen).not.toHaveBeenCalled();
    });

    it('closes an open menu on click instead of toggling play', () => {
        jest.useFakeTimers();
        menuOpen = true;
        surface.attachSurface(element);
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        jest.advanceTimersByTime(300);
        expect(togglePlay).not.toHaveBeenCalled();
        expect(closePopovers).toHaveBeenCalledTimes(1);
    });

    it('closes popovers on an outside pointer-down', () => {
        surface.attachSurface(element);
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        expect(closePopovers).toHaveBeenCalledTimes(1);
        outside.remove();
    });

    it('does not close popovers when the pointer-down is inside the surface', () => {
        surface.attachSurface(element);
        element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        expect(closePopovers).not.toHaveBeenCalled();
    });

    it('detaches the previous surface listeners when rebinding', () => {
        const first = document.createElement('div');
        surface.attachSurface(first);
        surface.attachSurface(element);
        first.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
        expect(reveal).not.toHaveBeenCalled();
    });

    it('cancels a pending click-to-play action when rebinding', () => {
        jest.useFakeTimers();
        const first = document.createElement('div');
        surface.attachSurface(first);
        first.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        surface.attachSurface(element);
        jest.advanceTimersByTime(300);

        expect(togglePlay).not.toHaveBeenCalled();
    });

    it('stops reacting after dispose', () => {
        surface.attachSurface(element);
        surface.dispose();
        element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
        expect(reveal).not.toHaveBeenCalled();
    });

    describe('touch', () => {
        it('does not reveal on the pointer activity a tap synthesizes', () => {
            surface.attachSurface(element);
            element.dispatchEvent(pointerTypedEvent('pointerenter', 'touch'));
            element.dispatchEvent(pointerTypedEvent('pointermove', 'touch'));
            expect(reveal).not.toHaveBeenCalled();
        });

        it('reveals on a tap while hidden and never queues play', () => {
            jest.useFakeTimers();
            controlsVisible = false;
            surface.attachSurface(element);
            element.dispatchEvent(pointerTypedEvent('click', 'touch'));
            jest.advanceTimersByTime(300);
            expect(reveal).toHaveBeenCalledTimes(1);
            expect(togglePlay).not.toHaveBeenCalled();
            expect(hideControls).not.toHaveBeenCalled();
        });

        it('hides on a viewport tap while visible instead of pausing', () => {
            jest.useFakeTimers();
            surface.attachSurface(element);
            element.dispatchEvent(pointerTypedEvent('click', 'touch'));
            jest.advanceTimersByTime(300);
            expect(hideControls).toHaveBeenCalledTimes(1);
            expect(reveal).not.toHaveBeenCalled();
            expect(togglePlay).not.toHaveBeenCalled();
        });

        it('dismisses an open menu on a tap instead of hiding the bar', () => {
            menuOpen = true;
            surface.attachSurface(element);
            element.dispatchEvent(pointerTypedEvent('click', 'touch'));
            expect(closePopovers).toHaveBeenCalledTimes(1);
            expect(hideControls).not.toHaveBeenCalled();
        });

        it('re-reveals on taps landing on interactive elements', () => {
            jest.useFakeTimers();
            const button = document.createElement('button');
            element.appendChild(button);
            surface.attachSurface(element);
            button.dispatchEvent(pointerTypedEvent('click', 'touch'));
            jest.advanceTimersByTime(300);
            expect(reveal).toHaveBeenCalledTimes(1);
            expect(togglePlay).not.toHaveBeenCalled();
        });

        it('attributes pointer-typeless events to a recent touch pointerdown', () => {
            document.dispatchEvent(pointerTypedEvent('pointerdown', 'touch'));
            expect(
                surface.wasTouchInteraction(new FocusEvent('focusin'))
            ).toBe(true);
            expect(surface.wasTouchInteraction(undefined)).toBe(true);

            document.dispatchEvent(pointerTypedEvent('pointerdown', 'mouse'));
            expect(
                surface.wasTouchInteraction(new FocusEvent('focusin'))
            ).toBe(false);
        });

        it('trusts an explicit pointer type over the pointerdown history', () => {
            document.dispatchEvent(pointerTypedEvent('pointerdown', 'touch'));
            expect(
                surface.wasTouchInteraction(
                    pointerTypedEvent('pointerenter', 'mouse')
                )
            ).toBe(false);
            expect(
                surface.wasTouchInteraction(
                    pointerTypedEvent('click', 'touch')
                )
            ).toBe(true);
        });
    });
});
