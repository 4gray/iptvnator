import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import type { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';

interface FloatingPlayerDependencies {
    mainWindow: () => BrowserWindow | null;
    reparent: (id: string, handle: Buffer) => void;
    setBounds: (id: string, bounds: EmbeddedMpvBounds) => void;
    togglePaused: (id: string) => void;
    setVolume: (id: string, volume: number) => void;
}

/** Windows native-view only. Reparents the video host without reloading MPV. */
export class EmbeddedMpvFloatingPlayer {
    private window: BrowserWindow | null = null;
    private sessionId: string | null = null;
    private readonly inlineBounds = new Map<string, EmbeddedMpvBounds>();

    constructor(private readonly dependencies: FloatingPlayerDependencies) {}

    rememberBounds(id: string, bounds: EmbeddedMpvBounds): boolean {
        this.inlineBounds.set(id, bounds);
        return id === this.sessionId;
    }

    update(id: string, paused: boolean, volume: number): void {
        if (
            id === this.sessionId &&
            this.window &&
            !this.window.isDestroyed()
        ) {
            this.window.webContents.send('EMBEDDED_MPV_FLOATING_STATE', {
                paused,
                volume,
            });
        }
    }

    async open(id: string): Promise<boolean> {
        if (this.sessionId === id && this.window) {
            this.window.focus();
            return true;
        }
        this.restore();
        const main = this.dependencies.mainWindow();
        if (!main || main.isDestroyed()) return false;
        const window = new BrowserWindow({
            width: 520,
            height: 360,
            minWidth: 320,
            minHeight: 240,
            title: 'IPTVnator — Picture in Picture',
            alwaysOnTop: true,
            show: false,
            autoHideMenuBar: true,
            backgroundColor: '#000000',
            webPreferences: {
                preload: path.join(
                    __dirname,
                    'assets/floating-player/preload.cjs'
                ),
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        this.window = window;
        this.sessionId = id;
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (event) =>
            event.preventDefault()
        );
        const command = (
            _event: Electron.IpcMainEvent,
            action: unknown,
            value: unknown
        ) => {
            if (_event.sender !== window.webContents || this.sessionId !== id)
                return;
            if (action === 'restore') this.restore();
            else if (action === 'pause') this.dependencies.togglePaused(id);
            else if (
                action === 'volume' &&
                typeof value === 'number' &&
                Number.isFinite(value)
            ) {
                this.dependencies.setVolume(
                    id,
                    Math.min(1, Math.max(0, value))
                );
            }
        };
        ipcMain.on('EMBEDDED_MPV_FLOATING_COMMAND', command);
        window.once('closed', () =>
            ipcMain.off('EMBEDDED_MPV_FLOATING_COMMAND', command)
        );
        window.on('resize', () => this.resize());
        window.on('move', () => this.resize());
        window.on('close', (event) => {
            if (this.window === window) {
                event.preventDefault();
                this.restore();
            }
        });
        try {
            await window.loadFile(
                path.join(__dirname, 'assets/floating-player/index.html')
            );
            if (this.window !== window || this.sessionId !== id) return false;
            this.dependencies.reparent(id, window.getNativeWindowHandle());
            this.resize();
            window.show();
            return true;
        } catch {
            this.restore();
            return false;
        }
    }

    private resize(): void {
        if (!this.window || !this.sessionId || this.window.isDestroyed())
            return;
        const [width, height] = this.window.getContentSize();
        const scale = screen.getDisplayMatching(
            this.window.getBounds()
        ).scaleFactor;
        this.dependencies.setBounds(this.sessionId, {
            x: 0,
            y: 0,
            width: width * scale,
            height: Math.max(1, height - 52) * scale,
        });
    }

    restore(): void {
        const window = this.window;
        const id = this.sessionId;
        if (!window || !id) return;
        const main = this.dependencies.mainWindow();
        // Move the child before destroying its floating parent.
        if (main && !main.isDestroyed()) {
            this.dependencies.reparent(id, main.getNativeWindowHandle());
            const bounds = this.inlineBounds.get(id);
            if (bounds) this.dependencies.setBounds(id, bounds);
        }
        this.window = null;
        this.sessionId = null;
        window.destroy();
    }

    dispose(id: string): void {
        if (this.sessionId === id) this.restore();
        this.inlineBounds.delete(id);
    }
}
