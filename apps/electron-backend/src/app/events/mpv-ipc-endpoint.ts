import { spawn, type SpawnOptions } from 'child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { externalPlayerProcessTeardownGate } from './external-player-process';

interface PlayerIpcEndpoint {
    path: string;
    dispose(): void;
}

export function createMpvIpcEndpoint(): PlayerIpcEndpoint | undefined {
    if (process.platform === 'win32')
        return {
            path: `\\\\.\\pipe\\iptvnator-mpv-${randomUUID()}`,
            dispose: () => undefined,
        };

    return createPrivatePlayerIpcEndpoint('mpv');
}

export function createPrivatePlayerIpcEndpoint(
    player: 'mpv' | 'vlc'
): PlayerIpcEndpoint | undefined {
    if (process.platform === 'win32') return undefined;
    try {
        // Keep the URL-bearing connection off paths other local users can bind.
        const directory = mkdtempSync(`/tmp/iptvnator-${player}-`);
        return {
            path: `${directory}/ipc`,
            dispose: () => {
                try {
                    rmSync(directory, { recursive: true, force: true });
                } catch {
                    /* A leftover private directory is safer than interrupting playback. */
                }
            },
        };
    } catch {
        return undefined;
    }
}

export function spawnPlayerWithEndpoint(
    command: string,
    args: string[],
    tracksProcess: boolean,
    endpoint?: PlayerIpcEndpoint,
    stdio: SpawnOptions['stdio'] = tracksProcess
        ? ['ignore', 'pipe', 'pipe']
        : 'ignore'
) {
    try {
        externalPlayerProcessTeardownGate.assertLaunchAllowed();
        const child = spawn(command, args, {
            shell: false,
            detached: !tracksProcess,
            stdio,
        });
        if (endpoint) {
            child.once('exit', endpoint.dispose);
            child.once('close', endpoint.dispose);
            child.once('error', () => {
                if (!child.pid) endpoint.dispose();
            });
        }
        return child;
    } catch (error) {
        endpoint?.dispose();
        throw error;
    }
}
