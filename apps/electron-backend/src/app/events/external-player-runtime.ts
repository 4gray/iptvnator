import {
    EXTERNAL_PLAYER_SESSION_UPDATE,
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import App from '../app';
import { isExternalPlayerTraceEnabled, trace } from '../services/debug-trace';
import { ExternalPlayerLaunchContext } from './external-player-launch-context';
import { ExternalPlayerSessionRegistry } from './external-player-session-registry';

export interface ExternalPlaybackSnapshot {
    positionSeconds: number;
    durationSeconds: number | null;
}

export function traceExternalPlayer(message: string, payload?: unknown): void {
    if (!isExternalPlayerTraceEnabled()) {
        return;
    }

    trace('external-player', message, payload);
}

function sendExternalPlayerSessionUpdate(session: ExternalPlayerSession): void {
    if (App.mainWindow && !App.mainWindow.isDestroyed()) {
        App.mainWindow.webContents.send(
            EXTERNAL_PLAYER_SESSION_UPDATE,
            session
        );
    }
}

export const externalPlayerSessions = new ExternalPlayerSessionRegistry(
    sendExternalPlayerSessionUpdate
);

export function buildPlayerStartError(
    player: 'MPV' | 'VLC',
    error: Error,
    launchContext: ExternalPlayerLaunchContext
): Error {
    const guidance =
        launchContext.mode === 'flatpak-host'
            ? `Make sure ${player} is installed on the host system and reachable via Flatpak host spawning at '${launchContext.playerPath}'.`
            : `Make sure ${player} is installed and the path '${launchContext.playerPath}' is correct.`;

    return new Error(
        `Failed to start ${player} player: ${error.message}. ${guidance}`
    );
}

export function sendPlayerErrorNotification(
    player: 'MPV' | 'VLC',
    error: string
): void {
    if (!App.mainWindow || App.mainWindow.isDestroyed()) {
        return;
    }

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
        userMessage = 'Stream not found. The URL may be incorrect or expired.';
    } else if (error.includes('Timed out') || error.includes('timeout')) {
        userMessage = 'Connection timed out. The server is not responding.';
    }

    App.mainWindow.webContents.send('player-error', {
        player,
        error: userMessage,
        originalError: error,
    });
}

export function sendPlaybackPositionUpdate(
    sessionId: string,
    contentInfo: PlayerContentInfo,
    snapshot: ExternalPlaybackSnapshot
): void {
    if (!App.mainWindow || App.mainWindow.isDestroyed()) {
        return;
    }

    externalPlayerSessions.markPlaying(sessionId);
    App.mainWindow.webContents.send('playback-position-update', {
        sessionId,
        positionSeconds: snapshot.positionSeconds,
        durationSeconds: snapshot.durationSeconds,
        ...contentInfo,
    });
}

export function maskUrlForLogs(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return rawUrl;
    }
}
