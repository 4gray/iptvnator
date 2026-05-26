import path from 'path';
import {
    ExternalPlayerName,
    parseExternalPlayerArguments,
    type ExternalPlayerArgumentsInput,
} from '@iptvnator/shared/interfaces';
import { existsSync, readdirSync } from 'fs';

export type PathExists = (path: string) => boolean;
export type ReadDirectory = (path: string) => string[];

export type ExternalPlayerLaunchMode = 'direct' | 'flatpak-host';

export interface PlayerPathOptions {
    platform?: NodeJS.Platform;
    isFlatpak?: boolean;
    pathExists?: PathExists;
    readDirectory?: ReadDirectory;
}

export interface ExternalPlayerLaunchContext {
    mode: ExternalPlayerLaunchMode;
    playerPath: string;
    command: string;
    argsPrefix: string[];
}

export interface ExternalPlayerSpawnSpec {
    mode: ExternalPlayerLaunchMode;
    playerPath: string;
    command: string;
    args: string[];
}

export function isRunningInFlatpak(
    pathExists: PathExists = existsSync,
    platform: NodeJS.Platform = process.platform
): boolean {
    return platform === 'linux' && pathExists('/.flatpak-info');
}

export function normalizeCustomPlayerPath(
    value: string | null | undefined
): string | null {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : null;
}

export function normalizePlayerPathForStore(
    value: string | null | undefined
): string {
    return normalizeCustomPlayerPath(value) ?? '';
}

const macOSAppBundleExecutableNames: Record<ExternalPlayerName, string> = {
    mpv: 'mpv',
    vlc: 'VLC',
};

function getMacOSAppBundleExecutableName(player: ExternalPlayerName): string {
    return macOSAppBundleExecutableNames[player];
}

function removeTrailingPathSeparators(value: string): string {
    return value.replace(/[\\/]+$/, '') || value;
}

function resolveMacOSAppBundlePlayerPath(
    player: ExternalPlayerName,
    playerPath: string,
    platform: NodeJS.Platform
): string {
    if (platform !== 'darwin') {
        return playerPath;
    }

    const appBundlePath = removeTrailingPathSeparators(playerPath);

    if (!/\.app$/i.test(appBundlePath)) {
        return playerPath;
    }

    return path.join(
        appBundlePath,
        'Contents',
        'MacOS',
        getMacOSAppBundleExecutableName(player)
    );
}

function getDefaultPlayerPath(
    player: ExternalPlayerName,
    options: PlayerPathOptions = {}
): string {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
        readDirectory = readdirSync,
    } = options;

    if (platform === 'linux' && isFlatpak) {
        return player;
    }

    if (player === 'mpv') {
        return getDefaultMpvPath({
            platform,
            isFlatpak,
            pathExists,
            readDirectory,
        });
    }

    return getDefaultVlcPath({
        platform,
        isFlatpak,
        pathExists,
        readDirectory,
    });
}

export function resolveExternalPlayerLaunchContext(
    player: ExternalPlayerName,
    customPlayerPath?: string,
    options: PlayerPathOptions = {}
): ExternalPlayerLaunchContext {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
        readDirectory = readdirSync,
    } = options;
    const playerPath =
        normalizeCustomPlayerPath(customPlayerPath) ??
        getDefaultPlayerPath(player, {
            platform,
            isFlatpak,
            pathExists,
            readDirectory,
        });
    const resolvedPlayerPath = resolveMacOSAppBundlePlayerPath(
        player,
        playerPath,
        platform
    );

    if (platform === 'linux' && isFlatpak) {
        return {
            mode: 'flatpak-host',
            playerPath: resolvedPlayerPath,
            command: 'flatpak-spawn',
            argsPrefix: ['--host', '--watch-bus', resolvedPlayerPath],
        };
    }

    return {
        mode: 'direct',
        playerPath: resolvedPlayerPath,
        command: resolvedPlayerPath,
        argsPrefix: [],
    };
}

export function buildExternalPlayerSpawnSpec(
    launchContext: ExternalPlayerLaunchContext,
    playerArgs: string[]
): ExternalPlayerSpawnSpec {
    return {
        mode: launchContext.mode,
        playerPath: launchContext.playerPath,
        command: launchContext.command,
        args: [...launchContext.argsPrefix, ...playerArgs],
    };
}

export { parseExternalPlayerArguments };

export function buildPlayerArgsWithCustomArguments(
    customArguments: ExternalPlayerArgumentsInput,
    playerArgs: string[]
): string[] {
    return [...parseExternalPlayerArguments(customArguments), ...playerArgs];
}

export function shouldReuseMpvInstance(
    requestedReuseInstance: boolean,
    isFlatpak: boolean = isRunningInFlatpak()
): boolean {
    return !isFlatpak && requestedReuseInstance;
}

export function shouldUseMpvSocketBridge(
    isFlatpak: boolean = isRunningInFlatpak()
): boolean {
    return !isFlatpak;
}

export function shouldReuseVlcInstance(
    requestedReuseInstance: boolean,
    isFlatpak: boolean = isRunningInFlatpak()
): boolean {
    return !isFlatpak && requestedReuseInstance;
}

export function getDefaultMpvPath(options: PlayerPathOptions = {}): string {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
    } = options;

    if (platform === 'linux' && isFlatpak) {
        return 'mpv';
    }

    if (platform === 'win32') {
        const windowsPaths = [
            path.join('C:', 'Program Files', 'mpv', 'mpv.exe'),
            path.join('C:', 'Program Files (x86)', 'mpv', 'mpv.exe'),
        ];

        for (const mpvPath of windowsPaths) {
            if (pathExists(mpvPath)) {
                return mpvPath;
            }
        }
        return 'mpv';
    } else if (platform === 'linux') {
        const linuxPaths = [
            '/usr/bin/mpv',
            '/usr/local/bin/mpv',
            '/snap/bin/mpv',
        ];

        for (const mpvPath of linuxPaths) {
            if (pathExists(mpvPath)) {
                return mpvPath;
            }
        }
        return 'mpv';
    } else if (platform === 'darwin') {
        const macosPaths = [
            '/Applications/mpv.app/Contents/MacOS/mpv',
            '/opt/homebrew/bin/mpv',
            '/usr/local/bin/mpv',
        ];

        for (const mpvPath of macosPaths) {
            if (pathExists(mpvPath)) {
                return mpvPath;
            }
        }
        return 'mpv';
    }

    return 'mpv';
}

export function getDefaultVlcPath(options: PlayerPathOptions = {}): string {
    const {
        platform = process.platform,
        isFlatpak = isRunningInFlatpak(),
        pathExists = existsSync,
        readDirectory = readdirSync,
    } = options;

    if (platform === 'linux' && isFlatpak) {
        return 'vlc';
    }

    if (platform === 'win32') {
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
            if (pathExists(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    } else if (platform === 'linux') {
        const linuxPaths = [
            '/usr/bin/vlc',
            '/usr/local/bin/vlc',
            '/snap/bin/vlc',
        ];

        for (const vlcPath of linuxPaths) {
            if (pathExists(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    } else if (platform === 'darwin') {
        const macosPaths = [
            '/Applications/VLC.app/Contents/MacOS/VLC',
            ...getHomebrewCaskVlcPaths(readDirectory),
        ];

        for (const vlcPath of macosPaths) {
            if (pathExists(vlcPath)) {
                return vlcPath;
            }
        }
        return 'vlc';
    }
    return 'vlc';
}

function getHomebrewCaskVlcPaths(readDirectory: ReadDirectory): string[] {
    const caskroomPath = '/opt/homebrew/Caskroom/vlc';

    try {
        return readDirectory(caskroomPath)
            .filter((entry) => entry.trim().length > 0)
            .map((entry) =>
                path.join(
                    caskroomPath,
                    entry,
                    'VLC.app',
                    'Contents',
                    'MacOS',
                    'VLC'
                )
            );
    } catch {
        return [];
    }
}
