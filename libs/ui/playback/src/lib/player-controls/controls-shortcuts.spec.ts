import { ControlsShortcuts } from './controls-shortcuts';

describe('ControlsShortcuts', () => {
    let shortcuts: ControlsShortcuts;
    let handlers: {
        isAvailable: jest.Mock<boolean, []>;
        canSeek: jest.Mock<boolean, []>;
        canAdjustVolume: jest.Mock<boolean, []>;
        canToggleFullscreen: jest.Mock<boolean, []>;
        onEscape: jest.Mock;
        togglePaused: jest.Mock;
        toggleFullscreen: jest.Mock;
        seekBy: jest.Mock;
        adjustVolume: jest.Mock;
        toggleMute: jest.Mock;
    };

    beforeEach(() => {
        shortcuts = new ControlsShortcuts();
        handlers = {
            isAvailable: jest.fn(() => true),
            canSeek: jest.fn(() => true),
            canAdjustVolume: jest.fn(() => true),
            canToggleFullscreen: jest.fn(() => true),
            onEscape: jest.fn(),
            togglePaused: jest.fn(),
            toggleFullscreen: jest.fn(),
            seekBy: jest.fn(),
            adjustVolume: jest.fn(),
            toggleMute: jest.fn(),
        };
        shortcuts.attach(handlers);
    });

    afterEach(() => {
        shortcuts.detach();
    });

    it('forwards playback, seek, volume, and fullscreen shortcuts', () => {
        expect(dispatchKey(' ')).toBe(true);
        expect(dispatchKey('ArrowLeft')).toBe(true);
        expect(dispatchKey('ArrowRight')).toBe(true);
        expect(dispatchKey('ArrowUp')).toBe(true);
        expect(dispatchKey('ArrowDown')).toBe(true);
        expect(dispatchKey('f')).toBe(true);
        expect(dispatchKey('M')).toBe(true);

        expect(handlers.togglePaused).toHaveBeenCalledTimes(1);
        expect(handlers.seekBy).toHaveBeenCalledWith(-5);
        expect(handlers.seekBy).toHaveBeenCalledWith(5);
        expect(handlers.adjustVolume).toHaveBeenCalledWith(0.05);
        expect(handlers.adjustVolume).toHaveBeenCalledWith(-0.05);
        expect(handlers.toggleFullscreen).toHaveBeenCalledTimes(1);
        expect(handlers.toggleMute).toHaveBeenCalledTimes(1);
    });

    it('does not consume keys for unsupported actions', () => {
        handlers.canSeek.mockReturnValue(false);
        handlers.canAdjustVolume.mockReturnValue(false);
        handlers.canToggleFullscreen.mockReturnValue(false);

        expect(dispatchKey('ArrowRight')).toBe(false);
        expect(dispatchKey('ArrowDown')).toBe(false);
        expect(dispatchKey('m')).toBe(false);
        expect(dispatchKey('f')).toBe(false);

        expect(handlers.seekBy).not.toHaveBeenCalled();
        expect(handlers.adjustVolume).not.toHaveBeenCalled();
        expect(handlers.toggleMute).not.toHaveBeenCalled();
        expect(handlers.toggleFullscreen).not.toHaveBeenCalled();
    });

    it('always allows escape to close popovers even when playback is unavailable', () => {
        handlers.isAvailable.mockReturnValue(false);

        expect(dispatchKey('k')).toBe(false);
        expect(dispatchKey('Escape')).toBe(false);

        expect(handlers.onEscape).toHaveBeenCalledTimes(1);
        expect(handlers.togglePaused).not.toHaveBeenCalled();
    });

    it('ignores shortcuts inside form controls', () => {
        const input = document.createElement('input');
        const select = document.createElement('select');
        document.body.append(input, select);

        input.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'ArrowUp',
                bubbles: true,
                cancelable: true,
            })
        );
        select.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'm',
                bubbles: true,
                cancelable: true,
            })
        );

        expect(handlers.adjustVolume).not.toHaveBeenCalled();
        expect(handlers.toggleMute).not.toHaveBeenCalled();
        input.remove();
        select.remove();
    });

    it('ignores shortcuts from buttons and ARIA menu controls', () => {
        const button = document.createElement('button');
        const menuItem = document.createElement('div');
        menuItem.setAttribute('role', 'menuitemradio');
        document.body.append(button, menuItem);

        button.focus();
        button.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: ' ',
                bubbles: true,
                cancelable: true,
            })
        );
        const menuEvent = new KeyboardEvent('keydown', {
            key: 'k',
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(menuEvent, 'composedPath', {
            value: () => [menuItem, document.body, document],
        });
        document.dispatchEvent(menuEvent);

        expect(handlers.togglePaused).not.toHaveBeenCalled();
        button.remove();
        menuItem.remove();
    });

    it('ignores modified playback shortcuts without preventing their defaults', () => {
        expect(dispatchKey('k', { metaKey: true })).toBe(false);
        expect(dispatchKey('f', { ctrlKey: true })).toBe(false);
        expect(dispatchKey('f', { metaKey: true })).toBe(false);
        expect(dispatchKey('ArrowRight', { altKey: true })).toBe(false);

        expect(handlers.togglePaused).not.toHaveBeenCalled();
        expect(handlers.toggleFullscreen).not.toHaveBeenCalled();
        expect(handlers.seekBy).not.toHaveBeenCalled();
    });

    it('still forwards Escape when modifier keys are held', () => {
        expect(
            dispatchKey('Escape', {
                altKey: true,
                ctrlKey: true,
                metaKey: true,
            })
        ).toBe(false);

        expect(handlers.onEscape).toHaveBeenCalledTimes(1);
    });

    it('ignores shortcuts when a text control is anywhere in the composed path', () => {
        // Simulate a shadow-DOM retargeted event: target is a host element,
        // but the real input is exposed via composedPath().
        const host = document.createElement('div');
        const input = document.createElement('input');
        document.body.append(host);

        const event = new KeyboardEvent('keydown', {
            key: 'ArrowUp',
            bubbles: true,
            cancelable: true,
        });
        Object.defineProperty(event, 'composedPath', {
            value: () => [input, host, document.body, document],
        });
        Object.defineProperty(event, 'target', { value: host });
        document.dispatchEvent(event);

        expect(handlers.adjustVolume).not.toHaveBeenCalled();
        host.remove();
    });

    it('routes shortcuts to the active instance and falls back after detach', () => {
        const other = new ControlsShortcuts();
        const otherHandlers = {
            isAvailable: jest.fn(() => true),
            canSeek: jest.fn(() => true),
            canAdjustVolume: jest.fn(() => true),
            canToggleFullscreen: jest.fn(() => true),
            onEscape: jest.fn(),
            togglePaused: jest.fn(),
            toggleFullscreen: jest.fn(),
            seekBy: jest.fn(),
            adjustVolume: jest.fn(),
            toggleMute: jest.fn(),
        };
        other.attach(otherHandlers);

        dispatchKey('k');
        expect(handlers.togglePaused).toHaveBeenCalledTimes(1);
        expect(otherHandlers.togglePaused).not.toHaveBeenCalled();

        other.activate();
        dispatchKey('k');
        expect(handlers.togglePaused).toHaveBeenCalledTimes(1);
        expect(otherHandlers.togglePaused).toHaveBeenCalledTimes(1);

        dispatchKey('Escape');
        expect(handlers.onEscape).toHaveBeenCalledTimes(1);
        expect(otherHandlers.onEscape).toHaveBeenCalledTimes(1);

        other.detach();
        dispatchKey('k');
        expect(handlers.togglePaused).toHaveBeenCalledTimes(2);
    });

    it('falls back to an available instance when the active one is unavailable', () => {
        const other = new ControlsShortcuts();
        const otherHandlers = {
            isAvailable: jest.fn(() => true),
            canSeek: jest.fn(() => true),
            canAdjustVolume: jest.fn(() => true),
            canToggleFullscreen: jest.fn(() => true),
            onEscape: jest.fn(),
            togglePaused: jest.fn(),
            toggleFullscreen: jest.fn(),
            seekBy: jest.fn(),
            adjustVolume: jest.fn(),
            toggleMute: jest.fn(),
        };
        other.attach(otherHandlers);
        handlers.isAvailable.mockReturnValue(false);

        dispatchKey('k');

        expect(handlers.togglePaused).not.toHaveBeenCalled();
        expect(otherHandlers.togglePaused).toHaveBeenCalledTimes(1);
        other.detach();
    });

    it('detaches its document listener', () => {
        shortcuts.detach();

        dispatchKey('k');

        expect(handlers.togglePaused).not.toHaveBeenCalled();
    });
});

function dispatchKey(key: string, init: KeyboardEventInit = {}): boolean {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
}
