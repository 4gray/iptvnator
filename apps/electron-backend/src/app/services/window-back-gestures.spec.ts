import { WINDOW_BACK_REQUESTED } from '@iptvnator/shared/interfaces';
import { attachWindowBackGestures } from './window-back-gestures';

type GestureListener = (event: unknown, value: string) => void;
type InputListener = (
    event: { preventDefault: () => void },
    input: Partial<Electron.Input>
) => void;

function createWindow(platform: NodeJS.Platform = 'win32') {
    const listeners = new Map<string, GestureListener>();
    const contentsListeners = new Map<string, InputListener>();
    const webContents = {
        isDestroyed: jest.fn(() => false),
        send: jest.fn(),
        on: jest.fn((event: string, listener: InputListener) => {
            contentsListeners.set(event, listener);
        }),
    };
    const win = {
        webContents,
        isDestroyed: jest.fn(() => false),
        on: jest.fn((event: string, listener: GestureListener) => {
            listeners.set(event, listener);
        }),
    };
    attachWindowBackGestures(
        win as unknown as Electron.BrowserWindow,
        platform
    );

    return {
        win,
        webContents,
        contentsListeners,
        emit(event: string, value: string): void {
            const listener = listeners.get(event);
            expect(listener).toBeDefined();
            listener?.({}, value);
        },
        /** One key event before it reaches the page; true when consumed. */
        key(input: Partial<Electron.Input>): boolean {
            const listener = contentsListeners.get('before-input-event');
            expect(listener).toBeDefined();
            const preventDefault = jest.fn();
            listener?.({ preventDefault }, input);
            return preventDefault.mock.calls.length > 0;
        },
    };
}

describe('attachWindowBackGestures', () => {
    it('forwards the Windows and Linux browser-backward app command', () => {
        const { emit, webContents } = createWindow();

        emit('app-command', 'browser-backward');

        expect(webContents.send).toHaveBeenCalledTimes(1);
        expect(webContents.send).toHaveBeenCalledWith(
            WINDOW_BACK_REQUESTED,
            'app-command'
        );
    });

    it('forwards the macOS swipe that means Back', () => {
        const { emit, webContents } = createWindow('darwin');

        emit('swipe', 'left');

        expect(webContents.send).toHaveBeenCalledTimes(1);
        expect(webContents.send).toHaveBeenCalledWith(
            WINDOW_BACK_REQUESTED,
            'swipe'
        );
    });

    it.each([
        ['app-command', 'browser-forward'],
        ['app-command', 'media-play-pause'],
        ['swipe', 'right'],
        ['swipe', 'up'],
        ['swipe', 'down'],
    ])('ignores %s %s: there is no Forward', (event, value) => {
        const { emit, webContents } = createWindow();

        emit(event, value);

        expect(webContents.send).not.toHaveBeenCalled();
    });

    it('sends nothing once the window or its contents are destroyed', () => {
        const { emit, win, webContents } = createWindow();

        webContents.isDestroyed.mockReturnValue(true);
        emit('app-command', 'browser-backward');
        win.isDestroyed.mockReturnValue(true);
        emit('swipe', 'left');

        expect(webContents.send).not.toHaveBeenCalled();
    });

    describe('Linux Browser Back key', () => {
        it('goes back once per press and keeps every event of the key from the page', () => {
            // Electron would raise `browser-backward` for the keydown and the
            // keyup of an unconsumed key.
            const { key, webContents } = createWindow('linux');

            const consumed = [
                key({ type: 'keyDown', key: 'BrowserBack' }),
                key({
                    type: 'keyDown',
                    key: 'BrowserBack',
                    isAutoRepeat: true,
                }),
                key({ type: 'keyUp', key: 'BrowserBack' }),
            ];

            expect(consumed).toEqual([true, true, true]);
            expect(webContents.send).toHaveBeenCalledTimes(1);
            expect(webContents.send).toHaveBeenCalledWith(
                WINDOW_BACK_REQUESTED,
                'app-command'
            );
        });

        it('leaves other keys to the page', () => {
            const { key, webContents } = createWindow('linux');

            expect(key({ type: 'keyDown', key: 'ArrowLeft', alt: true })).toBe(
                false
            );
            expect(key({ type: 'keyDown', key: 'BrowserForward' })).toBe(false);
            expect(webContents.send).not.toHaveBeenCalled();
        });

        it.each(['win32', 'darwin'] as const)(
            'is not taken on %s, where the key raises one command',
            (platform) => {
                const { contentsListeners } = createWindow(platform);

                expect(contentsListeners.has('before-input-event')).toBe(false);
            }
        );
    });
});
