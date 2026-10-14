import { WINDOW_BACK_REQUESTED } from '@iptvnator/shared/interfaces';
import { attachWindowBackGestures } from './window-back-gestures';

type GestureListener = (event: unknown, value: string) => void;

function createWindow() {
    const listeners = new Map<string, GestureListener>();
    const webContents = {
        isDestroyed: jest.fn(() => false),
        send: jest.fn(),
    };
    const win = {
        webContents,
        isDestroyed: jest.fn(() => false),
        on: jest.fn((event: string, listener: GestureListener) => {
            listeners.set(event, listener);
        }),
    };
    attachWindowBackGestures(win as unknown as Electron.BrowserWindow);

    return {
        win,
        webContents,
        emit(event: string, value: string): void {
            const listener = listeners.get(event);
            expect(listener).toBeDefined();
            listener?.({}, value);
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
        const { emit, webContents } = createWindow();

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
});
