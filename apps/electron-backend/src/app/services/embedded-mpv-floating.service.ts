import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import {
    clampPlaybackSeek,
    type EmbeddedMpvBounds,
} from '@iptvnator/shared/interfaces';
import type { FloatingPlaybackState } from './floating-playback-state';

interface FloatingPlayerDependencies {
    mainWindow: () => BrowserWindow | null;
    reparent: (id: string, handle: Buffer) => void;
    setBounds: (id: string, bounds: EmbeddedMpvBounds) => void;
    togglePaused: (id: string) => void;
    setVolume: (id: string, volume: number) => void;
    seek: (id: string, seconds: number) => void;
    seekBy: (id: string, delta: number) => void;
}

/** Windows native-view only. Reparents the video host without reloading MPV. */
export class EmbeddedMpvFloatingPlayer {
    private window: BrowserWindow | null = null;
    private overlay: BrowserWindow | null = null;
    private sessionId: string | null = null;
    private state: FloatingPlaybackState | null = null;
    private controlsVisible = true;
    private controlsFocused = false;
    private hoverTimer: ReturnType<typeof setInterval> | null = null;
    private drag: {
        x: number;
        y: number;
        windowX: number;
        windowY: number;
    } | null = null;
    private readonly inlineBounds = new Map<string, EmbeddedMpvBounds>();

    constructor(private readonly dependencies: FloatingPlayerDependencies) {}

    rememberBounds(id: string, bounds: EmbeddedMpvBounds): boolean {
        this.inlineBounds.set(id, bounds);
        return id === this.sessionId;
    }

    update(id: string, state: FloatingPlaybackState): void {
        if (
            id === this.sessionId &&
            this.window &&
            !this.window.isDestroyed()
        ) {
            this.state = state;
            this.overlay?.webContents.send(
                'EMBEDDED_MPV_FLOATING_STATE',
                state
            );
        }
    }

    async open(id: string): Promise<boolean> {
        if (this.sessionId === id && this.window) {
            if (this.window.isMinimized()) this.window.restore();
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
            frame: false,
            resizable: true,
            show: false,
            autoHideMenuBar: true,
            backgroundColor: '#000000',
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        const overlay = new BrowserWindow({
            parent: window,
            width: 520,
            height: 360,
            frame: false,
            transparent: true,
            resizable: false,
            show: false,
            skipTaskbar: true,
            alwaysOnTop: true,
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
        this.overlay = overlay;
        this.sessionId = id;
        this.state = null;
        this.controlsVisible = true;
        this.controlsFocused = false;
        for (const host of [window, overlay]) {
            host.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            host.webContents.on('will-navigate', (event) =>
                event.preventDefault()
            );
        }
        const command = (
            _event: Electron.IpcMainEvent,
            action: unknown,
            value: unknown
        ) => {
            if (_event.sender !== overlay.webContents || this.sessionId !== id)
                return;
            if (action === 'restore') this.returnToApp();
            else if (action === 'minimize') window.minimize();
            else if (action === 'pause') this.dependencies.togglePaused(id);
            else if (action === 'drag-start') {
                const cursor = screen.getCursorScreenPoint();
                const bounds = window.getBounds();
                this.drag = { ...cursor, windowX: bounds.x, windowY: bounds.y };
            } else if (action === 'drag-end') this.drag = null;
            else if (action === 'drag-move' && this.drag) {
                const cursor = screen.getCursorScreenPoint();
                window.setPosition(
                    this.drag.windowX + cursor.x - this.drag.x,
                    this.drag.windowY + cursor.y - this.drag.y
                );
            } else if (
                action === 'controls-focus' &&
                typeof value === 'boolean'
            ) {
                this.controlsFocused = value;
                if (value) this.setControlsVisible(true);
            } else if (
                (action === 'seek' || action === 'seek-by') &&
                typeof value === 'number' &&
                Number.isFinite(value) &&
                this.state?.canSeek
            ) {
                if (action === 'seek-by' && value !== -10 && value !== 10)
                    return;
                if (action === 'seek-by') {
                    this.dependencies.seekBy(id, value);
                    return;
                }
                const clamped = clampPlaybackSeek(this.state, value);
                if (clamped !== null) this.dependencies.seek(id, clamped);
            } else if (
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
        overlay.once('closed', () =>
            ipcMain.off('EMBEDDED_MPV_FLOATING_COMMAND', command)
        );
        window.on('resize', () => this.resize());
        window.on('move', () => this.resize());
        window.on('minimize', () => {
            this.controlsVisible = false;
            overlay.hide();
        });
        window.on('restore', () => {
            this.resize();
            this.controlsVisible = true;
            overlay.showInactive();
        });
        overlay.on('blur', () => {
            this.controlsFocused = false;
            this.drag = null;
        });
        overlay.on('close', (event) => {
            if (this.overlay === overlay) {
                event.preventDefault();
                this.returnToApp();
            }
        });
        window.on('close', (event) => {
            if (this.window === window) {
                event.preventDefault();
                this.returnToApp();
            }
        });
        try {
            await window.loadFile(
                path.join(__dirname, 'assets/floating-player/video.html')
            );
            await overlay.loadFile(
                path.join(__dirname, 'assets/floating-player/index.html')
            );
            if (this.window !== window || this.sessionId !== id) return false;
            this.dependencies.reparent(id, window.getNativeWindowHandle());
            this.resize();
            window.show();
            overlay.showInactive();
            this.hoverTimer = setInterval(() => {
                if (!this.window || this.window.isDestroyed()) return;
                const cursor = screen.getCursorScreenPoint();
                const bounds = this.window.getBounds();
                if (this.window.isMinimized()) return;
                const nearEdge =
                    cursor.x < bounds.x + 8 ||
                    cursor.x >= bounds.x + bounds.width - 8 ||
                    cursor.y < bounds.y + 8 ||
                    cursor.y >= bounds.y + bounds.height - 8;
                this.overlay?.setIgnoreMouseEvents(nearEdge, { forward: true });
                this.setControlsVisible(
                    this.controlsFocused ||
                        this.drag !== null ||
                        (cursor.x >= bounds.x &&
                            cursor.x < bounds.x + bounds.width &&
                            cursor.y >= bounds.y &&
                            cursor.y < bounds.y + bounds.height)
                );
            }, 150);
            this.hoverTimer.unref();
            return true;
        } catch {
            if (this.window === window) this.restore();
            return false;
        }
    }

    private setControlsVisible(visible: boolean): void {
        if (visible === this.controlsVisible || !this.window) return;
        this.controlsVisible = visible;
        if (visible) this.overlay?.showInactive();
        else this.overlay?.hide();
    }

    private resize(): void {
        if (!this.window || !this.sessionId || this.window.isDestroyed())
            return;
        const [width, height] = this.window.getContentSize();
        this.overlay?.setBounds(this.window.getContentBounds());
        const scale = screen.getDisplayMatching(
            this.window.getBounds()
        ).scaleFactor;
        this.dependencies.setBounds(this.sessionId, {
            x: 0,
            y: 0,
            width: width * scale,
            height: Math.max(1, height) * scale,
        });
    }

    private returnToApp(): void {
        const main = this.dependencies.mainWindow();
        this.restore();
        if (!main || main.isDestroyed()) return;
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
    }

    restore(): void {
        const window = this.window;
        const id = this.sessionId;
        if (!window || !id) return;
        const main = this.dependencies.mainWindow();
        // Move the child before destroying its floating parent.
        try {
            if (main && !main.isDestroyed()) {
                this.dependencies.reparent(id, main.getNativeWindowHandle());
                const bounds = this.inlineBounds.get(id);
                if (bounds) this.dependencies.setBounds(id, bounds);
            }
        } catch {
            console.warn('[Embedded MPV] Could not restore the floating view.');
        }
        this.window = null;
        this.sessionId = null;
        const overlay = this.overlay;
        this.overlay = null;
        overlay?.destroy();
        this.drag = null;
        this.state = null;
        if (this.hoverTimer) clearInterval(this.hoverTimer);
        this.hoverTimer = null;
        window.destroy();
    }

    dispose(id: string): void {
        if (this.sessionId === id) this.restore();
        this.inlineBounds.delete(id);
    }
}
