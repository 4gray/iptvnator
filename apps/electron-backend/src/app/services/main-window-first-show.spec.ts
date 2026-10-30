import { EventEmitter } from 'events';
import {
    type FirstShowWindow,
    showMainWindowWhenLoaded,
} from './main-window-first-show';

function createWindow(): FirstShowWindow &
    EventEmitter & {
        webContents: EventEmitter;
        destroyed: boolean;
    } {
    const window = Object.assign(new EventEmitter(), {
        destroyed: false,
        webContents: new EventEmitter(),
        isDestroyed(): boolean {
            return window.destroyed;
        },
    });
    return window;
}

describe('showMainWindowWhenLoaded', () => {
    it('shows the window at did-finish-load when ready-to-show has not fired', () => {
        // The Linux race: the hidden window gets no frame for its first
        // paint, so ready-to-show (and the splash's animation frame) would
        // wait about a second after the document has loaded.
        const window = createWindow();
        const show = jest.fn();
        showMainWindowWhenLoaded(window, show);

        window.webContents.emit('did-finish-load');

        expect(show).toHaveBeenCalledTimes(1);
    });

    it('shows the window at ready-to-show when that comes first', () => {
        const window = createWindow();
        const show = jest.fn();
        showMainWindowWhenLoaded(window, show);

        window.emit('ready-to-show');

        expect(show).toHaveBeenCalledTimes(1);
    });

    it('shows the window only once and detaches the other listener', () => {
        const window = createWindow();
        const show = jest.fn();
        showMainWindowWhenLoaded(window, show);

        window.webContents.emit('did-finish-load');
        window.emit('ready-to-show');
        // A reload loads the document again; the window is already shown.
        window.webContents.emit('did-finish-load');

        expect(show).toHaveBeenCalledTimes(1);
        expect(window.listenerCount('ready-to-show')).toBe(0);
        expect(window.webContents.listenerCount('did-finish-load')).toBe(0);
    });

    it('does not show a window that was destroyed before it loaded', () => {
        const window = createWindow();
        const show = jest.fn();
        showMainWindowWhenLoaded(window, show);

        window.destroyed = true;
        window.emit('ready-to-show');

        expect(show).not.toHaveBeenCalled();
    });
});
