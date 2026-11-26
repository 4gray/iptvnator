import { createConnection } from 'net';
import { PlayerContentInfo } from '@iptvnator/shared/interfaces';
import { ExternalPlayerPositionPollers } from './external-player-position-pollers';
import {
    sendPlaybackActivityUpdate,
    sendPlaybackPositionUpdate,
} from './external-player-runtime';

const pollers = new ExternalPlayerPositionPollers();

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

export function stopPositionPolling(sessionId?: string): void {
    pollers.stop(sessionId);
}

export function startPositionPolling(
    socketPath: string,
    contentInfo: PlayerContentInfo,
    sessionId: string
): void {
    pollers.start(sessionId, 2000, 5000, async (isCurrent) => {
        try {
            const position = await getMpvProperty(socketPath, 'time-pos');
            if (!isCurrent() || position === null) return;
            if (!pollers.isPrimary(sessionId)) {
                sendPlaybackActivityUpdate(
                    sessionId,
                    contentInfo,
                    Math.floor(position)
                );
                return;
            }

            const duration = await getMpvProperty(socketPath, 'duration');
            if (!isCurrent() || !pollers.isPrimary(sessionId)) return;
            sendPlaybackPositionUpdate(sessionId, contentInfo, {
                positionSeconds: Math.floor(position),
                durationSeconds: duration ? Math.floor(duration) : null,
            });
        } catch {
            if (isCurrent()) stopPositionPolling(sessionId);
        }
    });
}
