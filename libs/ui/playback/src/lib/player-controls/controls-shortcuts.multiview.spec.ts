import { ControlsShortcuts, PLAYER_SHORTCUT_EVENT } from './controls-shortcuts';

describe('ControlsShortcuts player shortcut event (multiview D3)', () => {
    let shortcuts: ControlsShortcuts;
    let host: HTMLElement;
    const toggleMute = jest.fn();

    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
        toggleMute.mockClear();
        shortcuts = new ControlsShortcuts();
        shortcuts.attach({
            isAvailable: () => true,
            hostElement: () => host,
            canTogglePaused: () => true,
            canSeek: () => false,
            canAdjustVolume: () => true,
            canToggleFullscreen: () => true,
            onEscape: jest.fn(),
            togglePaused: jest.fn(),
            toggleFullscreen: jest.fn(),
            seekBy: jest.fn(),
            adjustVolume: jest.fn(),
            toggleMute,
        });
    });

    afterEach(() => {
        shortcuts.detach();
        host.remove();
    });

    const press = (key: string) =>
        document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
                key,
                bubbles: true,
                cancelable: true,
            })
        );

    it('tells the player element before it acts on a key', () => {
        const order: string[] = [];
        host.addEventListener(PLAYER_SHORTCUT_EVENT, () => order.push('event'));
        toggleMute.mockImplementation(() => order.push('mute'));

        press('m');

        expect(order).toEqual(['event', 'mute']);
    });

    it('stays silent for a key it does not take', () => {
        const heard = jest.fn();
        host.addEventListener(PLAYER_SHORTCUT_EVENT, heard);

        press('ArrowLeft');
        press('x');

        expect(heard).not.toHaveBeenCalled();
    });
});
