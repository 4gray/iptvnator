import { spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { externalPlayerProcessTeardownGate } from './external-player-process';

interface MpvIpcEndpoint {
    path: string;
    dispose(): void;
}

export function createMpvIpcEndpoint(): MpvIpcEndpoint | undefined {
    if (process.platform === 'win32')
        return {
            path: `\\\\.\\pipe\\iptvnator-mpv-${randomUUID()}`,
            dispose: () => undefined,
        };

    try {
        // Keep the URL-bearing connection off paths other local users can bind.
        const directory = mkdtempSync('/tmp/iptvnator-mpv-');
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

export function spawnMpvWithEndpoint(
    command: string,
    args: string[],
    tracksProcess: boolean,
    endpoint?: MpvIpcEndpoint
) {
    try {
        externalPlayerProcessTeardownGate.assertLaunchAllowed();
        const child = spawn(command, args, {
            shell: false,
            detached: !tracksProcess,
            stdio: tracksProcess ? ['ignore', 'pipe', 'pipe'] : 'ignore',
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
