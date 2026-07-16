import { ControlsSurface } from './controls-surface';

describe('ControlsSurface', () => {
    let reveal: jest.Mock;
    let toggleFullscreen: jest.Mock;
    let closePopovers: jest.Mock;
    let togglePlay: jest.Mock;
    let canTogglePlay: boolean;
    let menuOpen: boolean;
    let surface: ControlsSurface;
    let element: HTMLElement;

    beforeEach(() => {
        reveal = jest.fn();
        toggleFullscreen = jest.fn();
        closePopovers = jest.fn();
        togglePlay = jest.fn();
        canTogglePlay = true;
        menuOpen = false;
        element = document.createElement('div');
        document.body.appendChild(element);
        surface = new ControlsSurface({
            reveal,
            toggleFullscreen,
            closePopovers,
            togglePlay,
            canTogglePlay: () => canTogglePlay,
            isMenuOpen: () => menuOpen,
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
});
