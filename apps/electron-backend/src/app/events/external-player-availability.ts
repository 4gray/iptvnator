import { accessSync, constants, statSync } from 'fs';
import path from 'path';
import { resolveExternalPlayerLaunchContext } from './external-player-launch-context';

/** Check the command playback will launch without starting a player. */
export function externalPlayerAvailable(
    player: 'mpv' | 'vlc',
    customPath?: string,
    options: {
        platform?: NodeJS.Platform;
        searchPath?: string;
        isFlatpak?: boolean;
        executable?: (file: string) => boolean;
        workingDirectory?: string;
    } = {}
): boolean | null {
    const platform = options.platform ?? process.platform;
    const context = resolveExternalPlayerLaunchContext(player, customPath, {
        platform,
        isFlatpak: options.isFlatpak,
    });
    // The sandbox's filesystem cannot establish host player availability.
    if (context.mode === 'flatpak-host') return null;
    const executable =
        options.executable ??
        ((file: string) => {
            try {
                if (!statSync(file).isFile()) return false;
                accessSync(
                    file,
                    platform === 'win32' ? constants.F_OK : constants.X_OK
                );
                return true;
            } catch {
                return false;
            }
        });
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const command = context.command;
    const names =
        platform === 'win32'
            ? [command, command + '.com', command + '.exe']
            : [command];
    if (paths.isAbsolute(command) || /[\\/]/.test(command)) {
        return names.some(executable);
    }
    if (
        platform === 'win32' &&
        names.some((name) =>
            executable(
                paths.join(options.workingDirectory ?? process.cwd(), name)
            )
        )
    )
        return true;
    return (options.searchPath ?? process.env.PATH ?? '')
        .split(platform === 'win32' ? ';' : ':')
        .some((directory) =>
            names.some((name) =>
                executable(
                    paths.join(
                        directory.replace(/^"|"$/g, '') ||
                            (options.workingDirectory ?? process.cwd()),
                        name
                    )
                )
            )
        );
}
