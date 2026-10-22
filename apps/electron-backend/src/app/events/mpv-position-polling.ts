import { createConnection } from 'net';
import { PlayerContentInfo } from '@iptvnator/shared/interfaces';
import { sendPlaybackPositionUpdate } from './external-player-runtime';

/**
 * Playback-position polling of an external MPV over its IPC socket. One poll
 * runs at a time across launches: starting a new one stops the previous one.
 */
let positionPollingInterval: NodeJS.Timeout | null = null;
// The first poll waits for MPV to open its IPC socket. The handle is kept so
// a player that exits during that wait does not start an orphaned interval.
let positionPollingDelay: NodeJS.Timeout | null = null;
// Bumped on every stop. A poll that was already awaiting an IPC reply when
// polling stopped (for example when a reused player loads the next stream)
// must not report what it reads under the previous content.
let positionPollingGeneration = 0;

async function getMpvProperty(
    socketPath: string,
    property: string
): Promise<number | null> {
    return new Promise((resolve) => {
        const client = createConnection(socketPath);
        const request =
            JSON.stringify({
                command: ['get_property', property],
            }) + '\n';

        let data = '';

        client.on('connect', () => {
            client.write(request);
        });

        const timeoutHandle = setTimeout(() => {
            client.destroy();
            resolve(null);
        }, 2000);

        client.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('\n')) {
                clearTimeout(timeoutHandle);
                try {
                    const lines = data.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        const response = JSON.parse(line);
                        if (response.data !== undefined) {
                            client.destroy();
                            resolve(response.data);
                            return;
                        }
                    }
                } catch {
                    // Ignore partial JSON while MPV is still writing.
                }
            }
        });

        client.on('end', () => {
            clearTimeout(timeoutHandle);
            if (data && !data.includes('\n')) {
                try {
                    const response = JSON.parse(data);
                    resolve(response.data ?? null);
                } catch {
                    resolve(null);
                }
            }
        });

        client.on('error', () => {
            clearTimeout(timeoutHandle);
            resolve(null);
        });
    });
}

export function stopPositionPolling(): void {
    positionPollingGeneration += 1;
    if (positionPollingDelay) {
        clearTimeout(positionPollingDelay);
        positionPollingDelay = null;
    }
    if (positionPollingInterval) {
        clearInterval(positionPollingInterval);
        positionPollingInterval = null;
    }
}

export function startPositionPolling(
    socketPath: string,
    contentInfo: PlayerContentInfo,
    sessionId: string
): void {
    stopPositionPolling();
    const generation = positionPollingGeneration;
    const isCurrent = () => generation === positionPollingGeneration;

    positionPollingDelay = setTimeout(() => {
        positionPollingDelay = null;
        positionPollingInterval = setInterval(async () => {
            try {
                const position = await getMpvProperty(socketPath, 'time-pos');
                if (!isCurrent()) return;
                const duration = await getMpvProperty(socketPath, 'duration');
                if (!isCurrent()) return;

                if (position !== null) {
                    sendPlaybackPositionUpdate(sessionId, contentInfo, {
                        positionSeconds: Math.floor(position),
                        durationSeconds: duration ? Math.floor(duration) : null,
                    });
                }
            } catch {
                stopPositionPolling();
            }
        }, 5000);
    }, 2000);
}
