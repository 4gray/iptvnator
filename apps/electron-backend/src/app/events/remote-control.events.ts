import { BrowserWindow, ipcMain } from 'electron';
import * as http from 'http';
import { httpServer } from '../server/http-server';
import { store } from '../services/store.service';

interface RemoteControlCommand {
    type:
        | 'channel-select-number'
        | 'volume-up'
        | 'volume-down'
        | 'volume-toggle-mute';
    number?: number;
}

interface RemoteControlStatus {
    portal: 'm3u' | 'xtream' | 'stalker' | 'unknown';
    isLiveView: boolean;
    channelName?: string;
    channelNumber?: number;
    epgTitle?: string;
    epgStart?: string;
    epgEnd?: string;
    supportsVolume?: boolean;
    volume?: number;
    muted?: boolean;
    updatedAt?: string;
}

class RemoteControlEvents {
    private remoteControlStatus: RemoteControlStatus = {
        portal: 'unknown',
        isLiveView: false,
        supportsVolume: false,
        updatedAt: new Date().toISOString(),
    };

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
        httpServer.registerRemoteControlHandler(
            '/api/remote-control/channel/select-number',
            this.handleChannelSelectNumber.bind(this)
        );
        httpServer.registerRemoteControlHandler(
            '/api/remote-control/volume/up',
            this.handleVolumeUp.bind(this)
        );
        httpServer.registerRemoteControlHandler(
            '/api/remote-control/volume/down',
            this.handleVolumeDown.bind(this)
        );
        httpServer.registerRemoteControlHandler(
            '/api/remote-control/volume/toggle-mute',
            this.handleToggleMute.bind(this)
        );
        httpServer.registerRemoteControlHandler(
            '/api/remote-control/status',
            this.handleGetStatus.bind(this)
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

        ipcMain.on(
            'REMOTE_CONTROL_STATUS_UPDATE',
            (_event, status: Partial<RemoteControlStatus>) => {
                this.remoteControlStatus = {
                    ...this.remoteControlStatus,
                    ...status,
                    updatedAt: new Date().toISOString(),
                };
            }
        );
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
     * HTTP handler for selecting channel by number
     */
    private handleChannelSelectNumber(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        this.readJsonBody(req, res, (body) => {
            const value = Number(body?.number);
            if (!Number.isFinite(value) || value < 1) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid channel number' }));
                return;
            }

            this.sendRemoteCommandToRenderer({
                type: 'channel-select-number',
                number: Math.floor(value),
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        });
    }

    private handleVolumeUp(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        this.sendRemoteCommandToRenderer({ type: 'volume-up' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    }

    private handleVolumeDown(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        this.sendRemoteCommandToRenderer({ type: 'volume-down' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    }

    private handleToggleMute(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        this.sendRemoteCommandToRenderer({ type: 'volume-toggle-mute' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    }

    private handleGetStatus(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.remoteControlStatus));
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

    private sendRemoteCommandToRenderer(command: RemoteControlCommand): void {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
            windows[0].webContents.send('REMOTE_CONTROL_COMMAND', command);
            console.log(
                `Sent REMOTE_CONTROL_COMMAND ${command.type} to renderer`
            );
        } else {
            console.warn('No browser windows found to send remote command');
        }
    }

    private readJsonBody(
        req: http.IncomingMessage,
        res: http.ServerResponse,
        callback: (body: any) => void
    ): void {
        let data = '';
        req.on('data', (chunk: Buffer) => {
            data += chunk.toString();
        });
        req.on('end', () => {
            if (!data) {
                callback({});
                return;
            }

            try {
                callback(JSON.parse(data));
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
            }
        });
    }
}

export default new RemoteControlEvents();
