import path from 'path';
import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';

export const VLC_CASKROOM_PATH = '/opt/homebrew/Caskroom/vlc';

/** Ordered install candidates shared by launch and availability discovery. */
export function defaultExternalPlayerPaths(
    player: ExternalPlayerName,
    platform: NodeJS.Platform,
    vlcCaskEntries: string[] = []
): string[] {
    if (platform === 'win32') {
        const folders = player === 'mpv' ? ['mpv'] : ['VideoLAN', 'VLC'];
        return ['Program Files', 'Program Files (x86)'].map((folder) =>
            path.win32.join('C:', folder, ...folders, `${player}.exe`)
        );
    }
    if (platform === 'linux') {
        return ['/usr/bin', '/usr/local/bin', '/snap/bin'].map((folder) =>
            path.posix.join(folder, player)
        );
    }
    if (platform === 'darwin') {
        if (player === 'mpv') {
            return [
                '/Applications/mpv.app/Contents/MacOS/mpv',
                '/opt/homebrew/bin/mpv',
                '/usr/local/bin/mpv',
            ];
        }
        return [
            '/Applications/VLC.app/Contents/MacOS/VLC',
            ...vlcCaskEntries
                .filter((entry) => entry.trim().length > 0)
                .map((entry) =>
                    path.posix.join(
                        VLC_CASKROOM_PATH,
                        entry,
                        'VLC.app',
                        'Contents',
                        'MacOS',
                        'VLC'
                    )
                ),
        ];
    }
    return [];
}
