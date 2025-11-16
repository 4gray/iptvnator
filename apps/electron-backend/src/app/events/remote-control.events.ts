import { BrowserWindow, ipcMain } from 'electron';
import * as http from 'http';
import { httpServer } from '../server/http-server';
import { store } from '../services/store.service';

class RemoteControlEvents {
    /**
     * Bootstrap remote control events
     */
    bootstrapRemoteControlEvents(): void {
        // Register HTTP API endpoints
        httpServer.registerRemoteControlHandler(
            '/api/remote-control/channel/up',
            this.handleChannelUp.bind(this)
        );

        httpServer.registerRemoteControlHandler(
            '/api/remote-control/channel/down',
            this.handleChannelDown.bind(this)
        );

        // Start HTTP server if remote control is enabled in settings
        const remoteControlEnabled = store.get('remoteControl', false);
        const remoteControlPort = store.get('remoteControlPort', 8765);
        if (remoteControlEnabled) {
            httpServer.start(remoteControlPort);
        }

        // Register IPC handlers (for when the main app wants to use remote control)
        ipcMain.handle('REMOTE_CONTROL_CHANNEL_UP', () => {
            return this.changeChannelUp();
        });

        ipcMain.handle('REMOTE_CONTROL_CHANNEL_DOWN', () => {
            return this.changeChannelDown();
        });
    }

    /**
     * HTTP handler for channel up
     */
    private handleChannelUp(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        this.changeChannelUp();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    }

    /**
     * HTTP handler for channel down
     */
    private handleChannelDown(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        this.changeChannelDown();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    }

    /**
     * Change to the next channel
     */
    private changeChannelUp(): void {
        console.log('Channel UP requested');
        this.sendChannelChangeToRenderer('up');
    }

    /**
     * Change to the previous channel
     */
    private changeChannelDown(): void {
        console.log('Channel DOWN requested');
        this.sendChannelChangeToRenderer('down');
    }

    /**
     * Send channel change message to the renderer process
     */
    private sendChannelChangeToRenderer(direction: 'up' | 'down'): void {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].webContents.send('CHANNEL_CHANGE', { direction });
            console.log(`Sent CHANNEL_CHANGE ${direction} to renderer`);
        } else {
            console.warn('No browser windows found to send channel change');
        }
    }
}

export default new RemoteControlEvents();
