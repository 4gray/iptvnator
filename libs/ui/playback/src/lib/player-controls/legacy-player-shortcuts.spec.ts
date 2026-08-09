import { LegacyPlayerShortcuts } from './legacy-player-shortcuts';

describe('LegacyPlayerShortcuts', () => {
    let shortcuts: LegacyPlayerShortcuts;
    let handlers: {
        isAvailable: jest.Mock<boolean, []>;
        hostElement: jest.Mock<HTMLElement | null, []>;
        canSeek: jest.Mock<boolean, []>;
        canToggleFullscreen: jest.Mock<boolean, []>;
        togglePaused: jest.Mock;
        toggleFullscreen: jest.Mock;
        seekBy: jest.Mock;
        adjustVolume: jest.Mock;
        toggleMute: jest.Mock;
    };

    beforeEach(() => {
        shortcuts = new LegacyPlayerShortcuts();
        handlers = {
            isAvailable: jest.fn(() => true),
            hostElement: jest.fn(() => null),
            canSeek: jest.fn(() => true),
            canToggleFullscreen: jest.fn(() => true),
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
        expect(dispatchKey('m')).toBe(true);

        expect(handlers.togglePaused).toHaveBeenCalledTimes(1);
        expect(handlers.seekBy).toHaveBeenCalledWith(-5);
        expect(handlers.seekBy).toHaveBeenCalledWith(5);
        expect(handlers.adjustVolume).toHaveBeenCalledWith(0.05);
        expect(handlers.adjustVolume).toHaveBeenCalledWith(-0.05);
        expect(handlers.toggleFullscreen).toHaveBeenCalledTimes(1);
        expect(handlers.toggleMute).toHaveBeenCalledTimes(1);
    });

    it('treats Escape as a no-op by default without consuming the key', () => {
        expect(dispatchKey('Escape')).toBe(false);
        expect(handlers.togglePaused).not.toHaveBeenCalled();
    });

    it('forwards Escape to a provided handler', () => {
        shortcuts.detach();
        const onEscape = jest.fn();
        shortcuts.attach({ ...handlers, onEscape });

        dispatchKey('Escape');

        expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('respects the seek and fullscreen gates', () => {
        handlers.canSeek.mockReturnValue(false);
        handlers.canToggleFullscreen.mockReturnValue(false);

        expect(dispatchKey('ArrowRight')).toBe(false);
        expect(dispatchKey('f')).toBe(false);

        expect(handlers.seekBy).not.toHaveBeenCalled();
        expect(handlers.toggleFullscreen).not.toHaveBeenCalled();
    });

    it('does nothing while unavailable', () => {
        handlers.isAvailable.mockReturnValue(false);

        expect(dispatchKey(' ')).toBe(false);
        expect(dispatchKey('m')).toBe(false);

        expect(handlers.togglePaused).not.toHaveBeenCalled();
        expect(handlers.toggleMute).not.toHaveBeenCalled();
    });

    it('opts out while the host element sits inside an inert region', () => {
        const inertRegion = document.createElement('div');
        inertRegion.setAttribute('inert', '');
        const host = document.createElement('div');
        inertRegion.appendChild(host);
        document.body.appendChild(inertRegion);
        handlers.hostElement.mockReturnValue(host);

        try {
            expect(dispatchKey(' ')).toBe(false);
            expect(handlers.togglePaused).not.toHaveBeenCalled();
        } finally {
            inertRegion.remove();
        }
    });

    it('stops handling keys after detach', () => {
        shortcuts.detach();

        dispatchKey(' ');

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
