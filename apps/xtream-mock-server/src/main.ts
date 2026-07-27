import { createServer } from 'node:http';
import {
    createXtreamMockApp,
    parseXtreamMockServerEnvironment,
} from './app/server.js';

function start(): void {
    let options;
    try {
        options = parseXtreamMockServerEnvironment(process.env);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Invalid configuration';
        console.error(`[xtream-mock] ${message}`);
        process.exit(1);
    }

    const server = createServer(createXtreamMockApp(options));
    const displayHost = options.host === '::1' ? '[::1]' : options.host;
    let shuttingDown = false;

    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            console.error(
                `[xtream-mock] Port ${options.port} is already in use.`
            );
        } else {
            console.error('[xtream-mock] Server error:', error.message);
        }
        process.exit(1);
    });

    server.listen(options.port, options.host, () => {
        const origin = `http://${displayHost}:${options.port}`;
        console.log(`[xtream-mock] Listening on ${origin}`);
        console.log(`[xtream-mock] Direct API: ${origin}/player_api.php`);
        console.log(`[xtream-mock] PWA proxy:  ${origin}/xtream`);
        console.log(`[xtream-mock] Health:     ${origin}/health`);
        if (options.control?.enabled) {
            console.log('[xtream-mock] Performance control enabled');
        }
    });

    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log('\n[xtream-mock] Shutting down...');
        server.close(() => process.exit(0));
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('uncaughtException', (error) => {
        console.error('[xtream-mock] Uncaught exception:', error.message);
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        const message =
            reason instanceof Error ? reason.message : 'Unknown rejection';
        console.error('[xtream-mock] Unhandled rejection:', message);
        process.exit(1);
    });
    process.stdin.resume();
    process.stdin.on('end', () => {
        /* The HTTP server handle intentionally keeps this process alive. */
    });
}

start();
