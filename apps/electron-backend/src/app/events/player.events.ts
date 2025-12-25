import { ipcMain } from 'electron';
/* import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    SET_MPV_PLAYER_PATH,
    SET_VLC_PLAYER_PATH,
} from 'shared-interfaces'; */
import App from '../app';
import {
    MPV_PLAYER_PATH,
    MPV_REUSE_INSTANCE,
    store,
    VLC_PLAYER_PATH,
} from '../services/store.service';

import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { createConnection } from 'net';
import path from 'path';

export default class PlayerEvents {
    static bootstrapPlayerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

// Keep track of the running MPV process for reuse
let mpvProcess: ChildProcess | null = null;
let mpvSocketPath: string | null = null;

// Helper function to send error notifications to the renderer
function sendPlayerErrorNotification(player: 'MPV' | 'VLC', error: string) {
    if (App.mainWindow && !App.mainWindow.isDestroyed()) {
        // Make error message more user-friendly
        let userMessage = error;

        if (error.includes('Failed to open')) {
            userMessage =
                'Failed to open stream. The URL may be invalid or the server is not responding.';
        } else if (
            error.includes('Protocol not found') ||
            error.includes('Unsupported protocol')
        ) {
            userMessage =
                'Unsupported stream protocol. Please check the stream URL.';
        } else if (
            error.includes('Connection refused') ||
            error.includes('Could not connect')
        ) {
            userMessage =
                'Cannot connect to the stream server. Please check your internet connection.';
        } else if (error.includes('403') || error.includes('Forbidden')) {
            userMessage =
                'Access denied. The stream may require valid credentials or headers.';
        } else if (error.includes('404') || error.includes('Not Found')) {
            userMessage =
                'Stream not found. The URL may be incorrect or expired.';
        } else if (error.includes('Timed out') || error.includes('timeout')) {
            userMessage = 'Connection timed out. The server is not responding.';
        }

        App.mainWindow.webContents.send('player-error', {
            player,
            error: userMessage,
            originalError: error,
        });
    }
}

// Helper function to send command to MPV via IPC
function sendMpvCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!mpvSocketPath) {
            reject(new Error('No MPV socket path available'));
            return;
        }

        const client = createConnection(mpvSocketPath);
        // MPV expects commands in the format: { "command": ["cmd", "arg1", "arg2"] }
        const request = JSON.stringify({ command: [command, ...args] }) + '\n';

        client.on('connect', () => {
            console.log('Connected to MPV socket, sending command:', request);
            client.write(request);
            client.end();
            resolve();
        });

        client.on('error', (err) => {
            console.error('MPV socket error:', err);
            reject(err);
        });
    });
}

ipcMain.handle(
    'OPEN_MPV_PLAYER',
    async (
        event,
        url: string,
        title: string,
        userAgent?: string,
        referer?: string,
        origin?: string
    ) => {
        try {
            const mpvPath = getMpvPath();
            const reuseInstance = store.get(MPV_REUSE_INSTANCE, false);

            console.log('Opening MPV player with path:', mpvPath);
            console.log('Reuse instance:', reuseInstance);
            console.log('URL:', url);
            console.log('User-Agent:', userAgent);
            console.log('Referer:', referer);
            console.log('Origin:', origin);

            // If reuse is enabled and there's an existing process, try to use it
            if (
                reuseInstance &&
                mpvProcess &&
                !mpvProcess.killed &&
                mpvSocketPath
            ) {
                console.log('Reusing existing MPV instance');
                try {
                    await sendMpvCommand('loadfile', [url, 'replace']);
                    console.log(
                        'Successfully loaded new URL in existing MPV instance'
                    );
                    return;
                } catch (err) {
                    console.error(
                        'Failed to send command to existing MPV:',
                        err
                    );
                    // If it fails, clear the reference and create a new one
                    mpvProcess = null;
                    mpvSocketPath = null;
                    // Fall through to create new instance
                }
            }

            // Create new MPV process
            console.log('Creating new MPV instance');

            // Generate unique socket path
            const socketPath =
                process.platform === 'win32'
                    ? `\\\\.\\pipe\\mpv-${Date.now()}`
                    : `/tmp/mpvsocket-${Date.now()}`;

            const args = [`--input-ipc-server=${socketPath}`, '--idle=yes'];

            // Add user agent if provided
            if (userAgent) {
                args.push(`--user-agent=${userAgent}`);
            }

            // Add referer if provided
            if (referer) {
                args.push(`--referrer=${referer}`);
            }

            // Add origin as custom HTTP header if provided
            // MPV doesn't have a direct --origin flag, so we use --http-header-fields
            if (origin) {
                args.push(`--http-header-fields=Origin: ${origin}`);
            }

            // Add title if provided
            if (title) {
                args.push(`--force-media-title=${title}`);
            }

            // Add URL last
            args.push(url);

            // Wrap spawn in a promise to catch startup errors
            await new Promise<void>((resolve, reject) => {
                const proc = spawn(mpvPath, args, {
                    shell: false,
                    detached: !reuseInstance,
                    // Only pipe stdio when reusing instance; use 'ignore' for detached to allow clean shutdown
                    stdio: reuseInstance ? ['ignore', 'pipe', 'pipe'] : 'ignore',
                });

                // Capture stdout
                if (proc.stdout) {
                    proc.stdout.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            console.log('[MPV stdout]:', output);

                            // MPV sometimes outputs errors to stdout instead of stderr
                            if (
                                output.includes('Failed to open') ||
                                output.includes('Error opening') ||
                                output.includes('Protocol not found') ||
                                output.includes('Connection refused') ||
                                output.includes('error') ||
                                output.includes('403') ||
                                output.includes('404')
                            ) {
                                console.error(
                                    '[MPV ERROR from stdout]:',
                                    output
                                );
                                sendPlayerErrorNotification('MPV', output);
                            }
                        }
                    });
                }

                // Capture stderr (MPV outputs most messages here)
                if (proc.stderr) {
                    proc.stderr.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            console.error('[MPV stderr]:', output);

                            // Check for common error patterns and send notifications
                            if (
                                output.includes('Failed to open') ||
                                output.includes(
                                    'Exiting... (Errors when loading file)'
                                ) ||
                                output.includes('Error opening') ||
                                output.includes('Protocol not found') ||
                                output.includes('Connection refused') ||
                                output.includes('error') ||
                                output.includes('403') ||
                                output.includes('404')
                            ) {
                                console.error('[MPV ERROR]:', output);
                                sendPlayerErrorNotification('MPV', output);
                            }
                        }
                    });
                }

                proc.on('error', (err) => {
                    console.error('Failed to start MPV player:', err);
                    mpvProcess = null;
                    mpvSocketPath = null;
                    reject(
                        new Error(
                            `Failed to start MPV player: ${err.message}. Make sure MPV is installed and the path '${mpvPath}' is correct.`
                        )
                    );
                });

                proc.on('exit', (code) => {
                    console.log(`MPV exited with code ${code}`);
                    mpvProcess = null;
                    mpvSocketPath = null;

                    // Log non-zero exit codes as errors and notify user
                    if (code !== 0 && code !== null) {
                        console.error(
                            `[MPV ERROR] MPV exited with error code ${code}`
                        );
                        sendPlayerErrorNotification(
                            'MPV',
                            `MPV player closed unexpectedly (exit code: ${code})`
                        );
                    }
                });

                // Store the process reference if reuse is enabled
                if (reuseInstance) {
                    mpvProcess = proc;
                    mpvSocketPath = socketPath;
                    console.log(
                        'Stored MPV process for reuse with socket:',
                        socketPath
                    );
                } else {
                    // Detach the process so it can continue running independently
                    proc.unref();
                }

                // Resolve immediately if spawn succeeds (error event would fire if it fails)
                // Give a small window to catch immediate spawn errors
                setTimeout(() => {
                    if (!proc.killed) {
                        resolve();
                    }
                }, 100);
            });
        } catch (error) {
            console.error('Error opening MPV player:', error);
            mpvProcess = null;
            mpvSocketPath = null;
            throw error;
        }
    }
);

ipcMain.handle('SET_MPV_PLAYER_PATH', (_event, mpvPlayerPath) => {
    console.log('... setting mpv player path', mpvPlayerPath);
    store.set(MPV_PLAYER_PATH, mpvPlayerPath);
});

ipcMain.handle('SET_MPV_REUSE_INSTANCE', (_event, reuseInstance: boolean) => {
    console.log('... setting mpv reuse instance', reuseInstance);
    store.set(MPV_REUSE_INSTANCE, reuseInstance);

    // If disabling reuse, kill the existing process
    if (!reuseInstance && mpvProcess && !mpvProcess.killed) {
        console.log('Disabling reuse, cleaning up existing MPV process');
        mpvProcess.kill();
        mpvProcess = null;
        mpvSocketPath = null;
    }
});

ipcMain.handle(
    'OPEN_VLC_PLAYER',
    async (
        event,
        url: string,
        title: string,
        userAgent?: string,
        referer?: string,
        origin?: string
    ) => {
        try {
            const vlcPath = getVlcPath();
            console.log('Opening VLC player with path:', vlcPath);
            console.log('URL:', url);
            console.log('User-Agent:', userAgent);
            console.log('Referer:', referer);
            console.log('Origin:', origin);

            const args: string[] = [];

            // Add user agent if provided (VLC uses :http-user-agent= format)
            if (userAgent) {
                args.push(`:http-user-agent=${userAgent}`);
            }

            // Add referer if provided (VLC uses :http-referrer= format)
            if (referer) {
                args.push(`:http-referrer=${referer}`);
            }

            // Note: VLC doesn't have a direct origin option, but origin is typically
            // included in referer for most IPTV use cases

            // Add title if provided
            if (title) {
                args.push(`--meta-title=${title}`);
            }

            // Add URL last
            args.push(url);

            // Wrap spawn in a promise to catch startup errors
            await new Promise<void>((resolve, reject) => {
                const proc = spawn(vlcPath, args, {
                    shell: false,
                    detached: true,
                    stdio: 'ignore', // Use 'ignore' for detached to allow clean shutdown
                });

                // Capture stdout
                if (proc.stdout) {
                    proc.stdout.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            console.log('[VLC stdout]:', output);

                            // VLC sometimes outputs errors to stdout instead of stderr
                            if (
                                output.includes('error') ||
                                output.includes('Error') ||
                                output.includes('failed') ||
                                output.includes('Failed') ||
                                output.includes('cannot open') ||
                                output.includes('Connection refused') ||
                                output.includes('403') ||
                                output.includes('404')
                            ) {
                                console.error(
                                    '[VLC ERROR from stdout]:',
                                    output
                                );
                                sendPlayerErrorNotification('VLC', output);
                            }
                        }
                    });
                }

                // Capture stderr
                if (proc.stderr) {
                    proc.stderr.on('data', (data) => {
                        const output = data.toString().trim();
                        if (output) {
                            console.error('[VLC stderr]:', output);

                            // Check for common error patterns and send notifications
                            if (
                                output.includes('error') ||
                                output.includes('Error') ||
                                output.includes('failed') ||
                                output.includes('Failed') ||
                                output.includes('cannot open') ||
                                output.includes('Connection refused') ||
                                output.includes('403') ||
                                output.includes('404')
                            ) {
                                console.error('[VLC ERROR]:', output);
                                sendPlayerErrorNotification('VLC', output);
                            }
                        }
                    });
                }

                proc.on('error', (err) => {
                    console.error('Failed to start VLC player:', err);
                    reject(
                        new Error(
                            `Failed to start VLC player: ${err.message}. Make sure VLC is installed and the path '${vlcPath}' is correct.`
                        )
                    );
                });

                proc.on('exit', (code) => {
                    console.log(`VLC exited with code ${code}`);

                    // Log non-zero exit codes as errors and notify user
                    if (code !== 0 && code !== null) {
                        console.error(
                            `[VLC ERROR] VLC exited with error code ${code}`
                        );
                        sendPlayerErrorNotification(
                            'VLC',
                            `VLC player closed unexpectedly (exit code: ${code})`
                        );
                    }
                });

                // Detach the process so it can continue running independently
                proc.unref();

                // Resolve immediately if spawn succeeds (error event would fire if it fails)
                // Give a small window to catch immediate spawn errors
                setTimeout(() => {
                    if (!proc.killed) {
                        resolve();
                    }
                }, 100);
            });
        } catch (error) {
            console.error('Error opening VLC player:', error);
            throw error;
        }
    }
);

ipcMain.handle('SET_VLC_PLAYER_PATH', (_event, vlcPlayerPath) => {
    console.log('... setting vlc player path', vlcPlayerPath);
    store.set(VLC_PLAYER_PATH, vlcPlayerPath);
});

function getMpvPath() {
    const customMpvPath = store.get(MPV_PLAYER_PATH);
    if (customMpvPath) {
        return customMpvPath;
    } else {
        return getDefaultMpvPath();
    }
}

function getVlcPath() {
    const customVlcPath = store.get(VLC_PLAYER_PATH);
    if (customVlcPath) {
        return customVlcPath;
    } else {
        return getDefaultVlcPath();
    }
}

function getDefaultMpvPath() {
    if (process.platform === 'win32') {
        // Check multiple common Windows paths
        const windowsPaths = [
            path.join('C:', 'Program Files', 'mpv', 'mpv.exe'),
            path.join('C:', 'Program Files (x86)', 'mpv', 'mpv.exe'),
        ];

        // Check if any of the paths exist
        for (const mpvPath of windowsPaths) {
            if (existsSync(mpvPath)) {
                return mpvPath;
            }
        }
        // Default to just 'mpv' if it's in PATH
        return 'mpv';
    } else if (process.platform === 'linux') {
        // Check multiple common Linux paths
        const linuxPaths = [
            '/usr/bin/mpv',
            '/usr/local/bin/mpv',
            '/snap/bin/mpv',
        ];

        for (const mpvPath of linuxPaths) {
            if (existsSync(mpvPath)) {
                return mpvPath;
            }
        }
        return 'mpv';
    } else if (process.platform === 'darwin') {
        // Check multiple common macOS paths
        const macosPaths = [
            '/Applications/mpv.app/Contents/MacOS/mpv',
            '/opt/homebrew/bin/mpv',
            '/usr/local/bin/mpv',
        ];

        for (const mpvPath of macosPaths) {
            if (existsSync(mpvPath)) {
                return mpvPath;
            }
        }
        return 'mpv';
    }

    // Fallback to just 'mpv' hoping it's in PATH
    return 'mpv';
}

function getDefaultVlcPath() {
    if (process.platform === 'win32') {
        // Check multiple common Windows paths (64-bit and 32-bit)
        const windowsPaths = [
            path.join('C:', 'Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
            path.join(
                'C:',
                'Program Files (x86)',
                'VideoLAN',
                'VLC',
                'vlc.exe'
            ),
        ];

        for (const vlcPath of windowsPaths) {
            if (existsSync(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    } else if (process.platform === 'linux') {
        // Check multiple common Linux paths
        const linuxPaths = [
            '/usr/bin/vlc',
            '/usr/local/bin/vlc',
            '/snap/bin/vlc',
        ];

        for (const vlcPath of linuxPaths) {
            if (existsSync(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    } else if (process.platform === 'darwin') {
        // Check multiple common macOS paths
        const macosPaths = [
            '/Applications/VLC.app/Contents/MacOS/VLC',
            '/opt/homebrew/Caskroom/vlc/*/VLC.app/Contents/MacOS/VLC',
        ];

        for (const vlcPath of macosPaths) {
            if (existsSync(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    }
    return 'vlc';
}
