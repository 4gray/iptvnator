import { EmbeddedMpvShortcuts } from './embedded-mpv-shortcuts';

describe('EmbeddedMpvShortcuts', () => {
    let shortcuts: EmbeddedMpvShortcuts;
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
        shortcuts = new EmbeddedMpvShortcuts();
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

    it('detaches its document listener', () => {
        shortcuts.detach();

        dispatchKey('k');

        expect(handlers.togglePaused).not.toHaveBeenCalled();
    });
});

function dispatchKey(key: string): boolean {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
}
