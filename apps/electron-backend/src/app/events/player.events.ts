import { ipcMain } from 'electron';
import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    SET_MPV_PLAYER_PATH,
    SET_VLC_PLAYER_PATH,
} from 'shared-interfaces';
import {
    MPV_PLAYER_PATH,
    store,
    VLC_PLAYER_PATH,
} from '../services/store.service';

import { spawn } from 'child_process';
import path from 'path';

export default class PlayerEvents {
    static bootstrapPlayerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle(OPEN_MPV_PLAYER, async (event, { url }) => {
    /* try {
        if (this.mpv === null) {
            this.mpv = this.createMpvInstance();
        }
        if (this.mpv.isRunning()) {
            await this.mpv.load(url);
        } else {
            await this.mpv.start();
            await this.mpv.load(url);
        }
    } catch (error) {
        console.log(error);
        event.sender.send(ERROR, {
            message: `Error: ${
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                error?.verbose ??
                'Something went wrong. Make sure that mpv player is installed on your system.'
            } `,
        });
    } */
});

ipcMain.handle(SET_MPV_PLAYER_PATH, (_event, mpvPlayerPath) => {
    console.log('... setting mpv player path', mpvPlayerPath);
    store.set(MPV_PLAYER_PATH, mpvPlayerPath);

    /* 
    // recreate mpv player instance with new binary path if it was changed
    if (store.get(MPV_PLAYER_PATH, mpvPlayerPath) !== mpvPlayerPath)
        mpv = createMpvInstance(); */
});

ipcMain.handle(OPEN_VLC_PLAYER, (event, { url }) => {
    const proc = spawn(getVlcPath(), [`"${url as string}"`], {
        shell: true,
    });

    proc.on('exit', (code) => {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`VLC exited with code ${code}`);
    });
});

ipcMain.handle(SET_VLC_PLAYER_PATH, (_event, vlcPlayerPath) => {
    console.log('... setting vlc player path', vlcPlayerPath);
    store.set(VLC_PLAYER_PATH, vlcPlayerPath);
});

function getVlcPath() {
    const customVlcPath = store.get(VLC_PLAYER_PATH);
    if (customVlcPath) {
        return customVlcPath;
    } else {
        return getDefaultVlcPath();
    }
}

function getDefaultVlcPath() {
    if (process.platform === 'win32') {
        return path.join(
            'C:',
            'Program Files (x86)',
            'VideoLAN',
            'VLC',
            'vlc.exe'
        ); // TODO: define more default paths like in tauri
    } else if (process.platform === 'linux') {
        return '/usr/bin/vlc';
    } else if (process.platform === 'darwin') {
        return '/Applications/VLC.app/Contents/MacOS/VLC';
    }
}
