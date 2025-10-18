import { ipcMain } from 'electron';
/* import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    SET_MPV_PLAYER_PATH,
    SET_VLC_PLAYER_PATH,
} from 'shared-interfaces'; */
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

ipcMain.handle('OPEN_MPV_PLAYER', async (event, url) => {
    try {
        const mpvPath = getMpvPath();
        const reuseInstance = store.get(MPV_REUSE_INSTANCE, false);

        console.log('Opening MPV player with path:', mpvPath);
        console.log('Reuse instance:', reuseInstance);
        console.log('URL:', url);

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
                console.error('Failed to send command to existing MPV:', err);
                // If it fails, clear the reference and create a new one
                mpvProcess = null;
                mpvSocketPath = null;
            }
        }

        // Create new MPV process
        console.log('Creating new MPV instance');

        // Generate unique socket path
        const socketPath =
            process.platform === 'win32'
                ? `\\\\.\\pipe\\mpv-${Date.now()}`
                : `/tmp/mpvsocket-${Date.now()}`;

        const args = [`--input-ipc-server=${socketPath}`, '--idle=yes', url];

        const proc = spawn(mpvPath, args, {
            shell: false,
            detached: !reuseInstance,
            stdio: 'ignore',
        });

        proc.on('error', (err) => {
            console.error('Failed to start MPV player:', err);
            mpvProcess = null;
            mpvSocketPath = null;
            /* event.sender.send(ERROR, {
                message: `Error: Failed to start MPV player. Make sure that mpv player is installed on your system and the path is correct.`,
            }); */
        });

        proc.on('exit', (code) => {
            console.log(`MPV exited with code ${code}`);
            mpvProcess = null;
            mpvSocketPath = null;
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
    } catch (error) {
        console.log(error);
        mpvProcess = null;
        mpvSocketPath = null;
    }
});

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

ipcMain.handle('OPEN_VLC_PLAYER', (event, url) => {
    const vlcPath = getVlcPath();
    console.log('Opening VLC player with path:', vlcPath);
    console.log('URL:', url);

    const proc = spawn(vlcPath, [url as string], {
        shell: false,
        detached: true,
        stdio: 'ignore',
    });

    proc.on('error', (err) => {
        console.error('Failed to start VLC player:', err);
    });

    proc.on('exit', (code) => {
        console.log(`VLC exited with code ${code}`);
    });

    // Detach the process so it can continue running independently
    proc.unref();
});

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
