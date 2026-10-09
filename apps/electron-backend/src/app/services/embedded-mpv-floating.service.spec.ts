import { EventEmitter } from 'events';
import { EmbeddedMpvFloatingPlayer } from './embedded-mpv-floating.service';
import { BrowserWindow, ipcMain } from 'electron';
import { floatingPlaybackState } from './floating-playback-state';

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
        showInactive = jest.fn();
        hide = jest.fn();
        minimize = jest.fn();
        restore = jest.fn(() => this.emit('restore'));
        setPosition = jest.fn();
        setBounds = jest.fn();
        setIgnoreMouseEvents = jest.fn();
        isMinimized = jest.fn(() => false);
        destroyed = false;
        getNativeWindowHandle = () => Buffer.from('floating');
        getContentSize = () => [520, 360];
        getBounds = () => ({ x: 0, y: 0, width: 520, height: 360 });
        getContentBounds = this.getBounds;
        isDestroyed = () => this.destroyed;
        destroy = jest.fn(() => {
            this.destroyed = true;
            this.emit('closed');
        });
    }
    return {
        BrowserWindow: jest.fn(() => new Window()),
        ipcMain: new EventEmitter(),
        screen: {
            getDisplayMatching: () => ({ scaleFactor: 1.5 }),
            getCursorScreenPoint: () => ({ x: -100, y: -100 }),
        },
    };
});

describe('Windows floating MPV host', () => {
    const inline = { x: 12, y: 20, width: 640, height: 360 };
    let player: EmbeddedMpvFloatingPlayer;
    let mainWindow: {
        isDestroyed: jest.Mock;
        getNativeWindowHandle: jest.Mock;
        isMinimized: jest.Mock;
        restore: jest.Mock;
        show: jest.Mock;
        focus: jest.Mock;
    };
    let callbacks: Parameters<typeof Object.assign>[0] & {
        mainWindow: jest.Mock;
        reparent: jest.Mock;
        setBounds: jest.Mock;
        togglePaused: jest.Mock;
        setVolume: jest.Mock;
        seek: jest.Mock;
        seekBy: jest.Mock;
    };
    const latestWindow = () =>
        (BrowserWindow as unknown as jest.Mock).mock.results.at(-1).value;
    beforeEach(() => {
        jest.clearAllMocks();
        ipcMain.removeAllListeners();
        mainWindow = {
            isDestroyed: jest.fn(() => false),
            getNativeWindowHandle: jest.fn(() => Buffer.from('main')),
            isMinimized: jest.fn(() => false),
            restore: jest.fn(),
            show: jest.fn(),
            focus: jest.fn(),
        };
        callbacks = {
            mainWindow: jest.fn(() => mainWindow),
            reparent: jest.fn(),
            setBounds: jest.fn(),
            togglePaused: jest.fn(),
            setVolume: jest.fn(),
            seek: jest.fn(),
            seekBy: jest.fn(),
        };
        player = new EmbeddedMpvFloatingPlayer(callbacks);
        player.rememberBounds('one', inline);
    });
    afterEach(() => player.restore());

    it.each(['reparent', 'setBounds'] as const)(
        'destroys floating hosts even if native %s restoration fails',
        async (operation) => {
            await player.open('one');
            const windows = (
                BrowserWindow as unknown as jest.Mock
            ).mock.results.map((entry) => entry.value);
            callbacks[operation].mockImplementationOnce(() => {
                throw new Error('Native restore failed');
            });
            expect(() => player.dispose('one')).not.toThrow();
            expect(windows.every((window) => window.destroyed)).toBe(true);
            expect(ipcMain.listenerCount('EMBEDDED_MPV_FLOATING_COMMAND')).toBe(
                0
            );
        }
    );

    it('keeps a reopened window when an older pending load rejects', async () => {
        const construct = (
            BrowserWindow as unknown as jest.Mock
        ).getMockImplementation();
        let rejectLoad!: (error: Error) => void;
        (BrowserWindow as unknown as jest.Mock).mockImplementationOnce(() => {
            const window = construct();
            window.loadFile.mockReturnValueOnce(
                new Promise((_resolve, reject) => {
                    rejectLoad = reject;
                })
            );
            return window;
        });
        const first = player.open('one');
        player.restore();
        expect(await player.open('one')).toBe(true);
        const current = latestWindow();
        rejectLoad(new Error('Old window closed'));
        expect(await first).toBe(false);
        expect(current.destroy).not.toHaveBeenCalled();
    });

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
            height: 540,
        });
        expect(
            (BrowserWindow as unknown as jest.Mock).mock.calls[0][0]
        ).toMatchObject({
            alwaysOnTop: true,
            frame: false,
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
        const state = floatingPlaybackState(true, 0.2, false, 20, 120, true);
        player.update('other', state);
        expect(latestWindow().webContents.send).not.toHaveBeenCalled();
        player.update('one', state);
        expect(latestWindow().webContents.send).toHaveBeenCalledWith(
            'EMBEDDED_MPV_FLOATING_STATE',
            state
        );
    });

    it.each([true, false])(
        'restores and focuses an existing window without creating another player (minimized: %s)',
        async (minimized) => {
            await player.open('one');
            const video = (BrowserWindow as unknown as jest.Mock).mock
                .results[0].value;
            const overlay = latestWindow();
            video.isMinimized.mockReturnValue(minimized);
            overlay.showInactive.mockClear();
            const nativeParents = callbacks.reparent.mock.calls.length;
            expect(await player.open('one')).toBe(true);
            expect(BrowserWindow).toHaveBeenCalledTimes(2);
            expect(callbacks.reparent).toHaveBeenCalledTimes(nativeParents);
            expect(video.restore).toHaveBeenCalledTimes(minimized ? 1 : 0);
            expect(video.focus).toHaveBeenCalledTimes(1);
            if (minimized) {
                expect(overlay.showInactive).toHaveBeenCalledTimes(1);
                expect(video.restore.mock.invocationCallOrder[0]).toBeLessThan(
                    video.focus.mock.invocationCallOrder[0]
                );
            }
        }
    );

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

    it('rejects seeking on live feeds without ranges and clamps buffered seeking', async () => {
        await player.open('one');
        const sender = latestWindow().webContents;
        player.update(
            'one',
            floatingPlaybackState(false, 1, true, 30, null, false)
        );
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender },
            'seek-by',
            10
        );
        expect(callbacks.seek).not.toHaveBeenCalled();
        player.update(
            'one',
            floatingPlaybackState(false, 1, true, 30, null, false, [
                { start: 25, end: 35 },
            ])
        );
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender },
            'seek-by',
            10
        );
        expect(callbacks.seekBy).toHaveBeenLastCalledWith('one', 10);
        ipcMain.emit('EMBEDDED_MPV_FLOATING_COMMAND', { sender }, 'seek', -100);
        expect(callbacks.seek).toHaveBeenLastCalledWith('one', 25);
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender },
            'seek-by',
            999
        );
        ipcMain.emit('EMBEDDED_MPV_FLOATING_COMMAND', { sender }, 'seek', NaN);
        expect(callbacks.seek).toHaveBeenCalledTimes(1);
    });

    it('hides the overlay outside the window without changing video bounds', async () => {
        jest.useFakeTimers();
        try {
            await player.open('one');
            const count = callbacks.setBounds.mock.calls.length;
            jest.advanceTimersByTime(150);
            expect(latestWindow().hide).toHaveBeenCalled();
            expect(callbacks.setBounds).toHaveBeenCalledTimes(count);
        } finally {
            player.restore();
            jest.useRealTimers();
        }
    });

    it('routes VOD skip commands through relative MPV seeking', async () => {
        await player.open('one');
        player.update(
            'one',
            floatingPlaybackState(false, 1, false, 30, 120, true)
        );
        const sender = latestWindow().webContents;
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender },
            'seek-by',
            10
        );
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender },
            'seek-by',
            10
        );
        expect(callbacks.seekBy.mock.calls).toEqual([
            ['one', 10],
            ['one', 10],
        ]);
        expect(callbacks.seek).not.toHaveBeenCalled();
    });

    it.each([0, 1])(
        'returns video when host %s closes and removes its command listener',
        async (hostIndex) => {
            await player.open('one');
            const event = { preventDefault: jest.fn() };
            (BrowserWindow as unknown as jest.Mock).mock.results[
                hostIndex
            ].value.emit('close', event);
            expect(event.preventDefault).toHaveBeenCalled();
            expect(callbacks.reparent).toHaveBeenLastCalledWith(
                'one',
                Buffer.from('main')
            );
            expect(ipcMain.listenerCount('EMBEDDED_MPV_FLOATING_COMMAND')).toBe(
                0
            );
            expect(mainWindow.focus).toHaveBeenCalledTimes(1);
        }
    );

    it.each([true, false])(
        'shows and focuses the main window on Return to app (minimized: %s)',
        async (minimized) => {
            await player.open('one');
            mainWindow.isMinimized.mockReturnValue(minimized);
            const overlay = latestWindow();
            ipcMain.emit(
                'EMBEDDED_MPV_FLOATING_COMMAND',
                { sender: overlay.webContents },
                'restore'
            );
            expect(callbacks.reparent).toHaveBeenLastCalledWith(
                'one',
                Buffer.from('main')
            );
            expect(overlay.destroy).toHaveBeenCalledTimes(1);
            expect(mainWindow.restore).toHaveBeenCalledTimes(minimized ? 1 : 0);
            expect(mainWindow.show).toHaveBeenCalledTimes(1);
            expect(mainWindow.focus).toHaveBeenCalledTimes(1);
            expect(overlay.destroy.mock.invocationCallOrder[0]).toBeLessThan(
                mainWindow.focus.mock.invocationCallOrder[0]
            );
        }
    );

    it.each(['dispose', 'replace', 'restore'] as const)(
        'does not activate the main window during automatic %s',
        async (operation) => {
            await player.open('one');
            mainWindow.isMinimized.mockReturnValue(true);
            if (operation === 'dispose') player.dispose('one');
            else if (operation === 'replace') await player.open('two');
            else player.restore();
            expect(mainWindow.restore).not.toHaveBeenCalled();
            expect(mainWindow.show).not.toHaveBeenCalled();
            expect(mainWindow.focus).not.toHaveBeenCalled();
        }
    );

    it('ignores a main window destroyed before Return to app', async () => {
        await player.open('one');
        const overlay = latestWindow();
        mainWindow.isDestroyed.mockReturnValue(true);
        ipcMain.emit(
            'EMBEDDED_MPV_FLOATING_COMMAND',
            { sender: overlay.webContents },
            'restore'
        );
        expect(overlay.destroy).toHaveBeenCalledTimes(1);
        expect(mainWindow.show).not.toHaveBeenCalled();
        expect(mainWindow.focus).not.toHaveBeenCalled();
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
