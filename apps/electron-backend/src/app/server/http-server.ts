import { app } from 'electron';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

/**
 * HTTP server for serving the remote control web app and providing REST API endpoints
 */
export class HttpServer {
    private server: http.Server | null = null;
    private port = 8765;
    private isEnabled = false;
    private distPath: string | null = null;
    private remoteControlHandlers: Map<
        string,
        (req: http.IncomingMessage, res: http.ServerResponse) => void
    > = new Map();

    /**
     * Get the path to the remote-control-web static files.
     * Lazily computed to avoid calling Electron APIs before app is ready.
     */
    private getDistPath(): string {
        if (this.distPath) {
            return this.distPath;
        }

        // Path to the built remote-control-web app
        // In development: use workspace root
        // In production: use app path
        const appPath = app.getAppPath();
        const isDev = !app.isPackaged;

        if (isDev) {
            // Development mode - use workspace root
            this.distPath = path.join(
                process.cwd(),
                'dist',
                'apps',
                'remote-control-web',
                'browser'
            );
        } else {
            // Production mode - files are bundled with the app
            // electron-builder copies remote-control-web/**/* directly to app root
            this.distPath = path.join(
                appPath,
                'remote-control-web',
                'browser'
            );
        }

        console.log('[HTTP Server] Serving from:', this.distPath);
        return this.distPath;
    }

    /**
     * Start the HTTP server
     */
    start(port?: number): void {
        if (port) {
            this.port = port;
        }

        if (this.server) {
            console.log('HTTP server is already running');
            return;
        }

        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.server.listen(this.port, () => {
            console.log(`HTTP server listening on port ${this.port}`);
            console.log(
                `Remote control available at: http://localhost:${this.port}`
            );
        });

        this.isEnabled = true;
    }

    /**
     * Stop the HTTP server
     */
    stop(): void {
        if (!this.server) {
            return;
        }

        this.server.close(() => {
            console.log('HTTP server stopped');
        });

        this.server = null;
        this.isEnabled = false;
    }

    /**
     * Update server settings
     */
    updateSettings(enabled: boolean, port: number): void {
        const needsRestart = this.isEnabled && enabled && this.port !== port;

        if (!enabled && this.isEnabled) {
            this.stop();
        } else if (enabled && !this.isEnabled) {
            this.start(port);
        } else if (needsRestart) {
            this.stop();
            this.start(port);
        }
    }

    /**
     * Register a handler for remote control API endpoints
     */
    registerRemoteControlHandler(
        path: string,
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
    ): void {
        this.remoteControlHandlers.set(path, handler);
    }

    /**
     * Handle incoming HTTP requests
     */
    private handleRequest(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        const url = req.url || '/';

        // Handle API requests
        if (url.startsWith('/api/remote-control/')) {
            const handler = this.remoteControlHandlers.get(url);
            if (handler) {
                handler(req, res);
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Endpoint not found' }));
            return;
        }

        // Serve static files from the remote-control-web app
        this.serveStaticFile(url, res);
    }

    /**
     * Serve static files
     */
    private serveStaticFile(url: string, res: http.ServerResponse): void {
        // Default to index.html for root path
        let filePath = url === '/' ? '/index.html' : url;

        // Security: prevent directory traversal
        filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');

        const fullPath = path.join(this.getDistPath(), filePath);

        fs.readFile(fullPath, (err, data) => {
            if (err) {
                // If file not found, try serving index.html (for Angular routing)
                if (err.code === 'ENOENT' && filePath !== '/index.html') {
                    this.serveStaticFile('/', res);
                    return;
                }

                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
                return;
            }

            // Determine content type
            const contentType = this.getContentType(fullPath);
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    }

    /**
     * Get content type based on file extension
     */
    private getContentType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const contentTypes: Record<string, string> = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
        };

        return contentTypes[ext] || 'application/octet-stream';
    }
}

export const httpServer = new HttpServer();
