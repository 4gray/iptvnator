import { ControlsShortcuts } from './controls-shortcuts';

describe('ControlsShortcuts', () => {
    let shortcuts: ControlsShortcuts;
    let handlers: {
        isAvailable: jest.Mock<boolean, []>;
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

    it('always allows escape to close popovers even when playback is unavailable', () => {
        handlers.isAvailable.mockReturnValue(false);

        expect(dispatchKey('Escape')).toBe(false);
        expect(dispatchKey('k')).toBe(false);

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

    it('does not double-execute a keypress already handled by another instance', () => {
        const other = new ControlsShortcuts();
        const otherHandlers = {
            isAvailable: jest.fn(() => true),
            onEscape: jest.fn(),
            togglePaused: jest.fn(),
            toggleFullscreen: jest.fn(),
            seekBy: jest.fn(),
            adjustVolume: jest.fn(),
            toggleMute: jest.fn(),
        };
        other.attach(otherHandlers);

        // A single keypress reaches both mounted instances via the document.
        dispatchKey('k');

        const first = handlers.togglePaused.mock.calls.length;
        const second = otherHandlers.togglePaused.mock.calls.length;
        // Exactly one instance handled it (the first to see it preventDefaults).
        expect(first + second).toBe(1);
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
