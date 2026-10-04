import { EventEmitter } from 'events';
import { EmbeddedMpvFloatingPlayer } from './embedded-mpv-floating.service';
import { BrowserWindow, ipcMain } from 'electron';

jest.mock('electron', () => {
    const { EventEmitter } = jest.requireActual('events');
    class Window extends EventEmitter {
        webContents = Object.assign(new EventEmitter(), {
            setWindowOpenHandler: jest.fn(),
            send: jest.fn(),
        });
        loadFile = jest.fn().mockResolvedValue(undefined);
        focus = jest.fn();
        show = jest.fn();
        destroyed = false;
        getNativeWindowHandle = () => Buffer.from('floating');
        getContentSize = () => [520, 360];
        getBounds = () => ({ x: 0, y: 0, width: 520, height: 360 });
        isDestroyed = () => this.destroyed;
        destroy = jest.fn(() => {
            this.destroyed = true;
            this.emit('closed');
        });
    }
    return {
        BrowserWindow: jest.fn(() => new Window()),
        ipcMain: new EventEmitter(),
        screen: { getDisplayMatching: () => ({ scaleFactor: 1.5 }) },
    };
});

describe('Windows floating MPV host', () => {
    const inline = { x: 12, y: 20, width: 640, height: 360 };
    let player: EmbeddedMpvFloatingPlayer;
    let callbacks: Parameters<typeof Object.assign>[0] & {
        mainWindow: jest.Mock;
        reparent: jest.Mock;
        setBounds: jest.Mock;
        togglePaused: jest.Mock;
        setVolume: jest.Mock;
    };
    const latestWindow = () =>
        (BrowserWindow as unknown as jest.Mock).mock.results.at(-1).value;
    beforeEach(() => {
        jest.clearAllMocks();
        ipcMain.removeAllListeners();
        callbacks = {
            mainWindow: jest.fn(() => ({
                isDestroyed: () => false,
                getNativeWindowHandle: () => Buffer.from('main'),
            })),
            reparent: jest.fn(),
            setBounds: jest.fn(),
            togglePaused: jest.fn(),
            setVolume: jest.fn(),
        };
        player = new EmbeddedMpvFloatingPlayer(callbacks);
        player.rememberBounds('one', inline);
    });
    afterEach(() => player.restore());

    it('moves the existing session and sizes video using the floating display scale', async () => {
        expect(await player.open('one')).toBe(true);
        expect(callbacks.reparent).toHaveBeenCalledWith(
            'one',
            Buffer.from('floating')
        );
        expect(callbacks.setBounds).toHaveBeenCalledWith('one', {
            x: 0,
            y: 0,
            width: 780,
            height: 462,
        });
        expect(
            (BrowserWindow as unknown as jest.Mock).mock.calls[0][0]
        ).toMatchObject({
            alwaysOnTop: true,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
    });

    it('retains inline updates while floating and restores before destroying the parent', async () => {
        await player.open('one');
        const window = latestWindow();
        const updated = { ...inline, width: 800 };
        expect(player.rememberBounds('one', updated)).toBe(true);
        player.restore();
        expect(callbacks.reparent).toHaveBeenLastCalledWith(
            'one',
            Buffer.from('main')
        );
        expect(callbacks.setBounds).toHaveBeenLastCalledWith('one', updated);
        expect(callbacks.reparent.mock.invocationCallOrder.at(-1)).toBeLessThan(
            window.destroy.mock.invocationCallOrder[0]
        );
    });

    it('sends only control state for the floating session', async () => {
        await player.open('one');
        player.update('other', true, 0.2);
        expect(latestWindow().webContents.send).not.toHaveBeenCalled();
        player.update('one', true, 0.2);
        expect(latestWindow().webContents.send).toHaveBeenCalledWith(
            'EMBEDDED_MPV_FLOATING_STATE',
            { paused: true, volume: 0.2 }
        );
    });

    it('focuses an existing window without creating a second player', async () => {
        await player.open('one');
        await player.open('one');
        expect(BrowserWindow).toHaveBeenCalledTimes(1);
        expect(latestWindow().focus).toHaveBeenCalled();
    });

    it('rejects commands from other renderers and clamps volume', async () => {
        await player.open('one');
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender: new EventEmitter() },
            'pause'
        );
        expect(callbacks.togglePaused).not.toHaveBeenCalled();
        const sender = latestWindow().webContents;
        ipcMain.emit('EMBEDDED_MPV_FLOATING_COMMAND', { sender }, 'pause');
        ipcMain.emit('EMBEDDED_MPV_FLOATING_COMMAND', { sender }, 'volume', 3);
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender },
            'volume',
            NaN
        );
        expect(callbacks.togglePaused).toHaveBeenCalledWith('one');
        expect(callbacks.setVolume).toHaveBeenCalledTimes(1);
        expect(callbacks.setVolume).toHaveBeenCalledWith('one', 1);
    });

    it('returns video when closed and removes its command listener', async () => {
        await player.open('one');
        const event = { preventDefault: jest.fn() };
        latestWindow().emit('close', event);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(callbacks.reparent).toHaveBeenLastCalledWith(
            'one',
            Buffer.from('main')
        );
        expect(ipcMain.listenerCount('EMBEDDED_MPV_FLOATING_COMMAND')).toBe(0);
    });

    it('does not attach a session disposed during window loading', async () => {
        const promise = player.open('one');
        const window = latestWindow();
        player.dispose('one');
        expect(await promise).toBe(false);
        expect(window.show).not.toHaveBeenCalled();
        expect(callbacks.reparent).not.toHaveBeenCalledWith(
            'one',
            Buffer.from('floating')
        );
    });
});
