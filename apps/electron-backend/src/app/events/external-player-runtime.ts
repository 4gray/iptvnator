import {
    ElectronBridgePlayerError,
    EXTERNAL_PLAYER_SESSION_UPDATE,
    ExternalPlayerErrorCode,
    ExternalPlayerSession,
    PlayerContentInfo,
    tagExternalPlayerError,
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
        tagExternalPlayerError(
            'start-failed',
            `Failed to start ${player} player: ${error.message}. ${guidance}`
        )
    );
}

/**
 * Maps player output to a code the renderer translates. Returns null for
 * output no code describes; the renderer then shows the raw output.
 */
export function classifyPlayerError(
    error: string
): ExternalPlayerErrorCode | null {
    if (error.includes('Failed to open')) {
        return 'stream-open-failed';
    }
    if (
        error.includes('Protocol not found') ||
        error.includes('Unsupported protocol')
    ) {
        return 'unsupported-protocol';
    }
    if (
        error.includes('Connection refused') ||
        error.includes('Could not connect')
    ) {
        return 'connection-failed';
    }
    if (error.includes('403') || error.includes('Forbidden')) {
        return 'access-denied';
    }
    if (error.includes('404') || error.includes('Not Found')) {
        return 'stream-not-found';
    }
    if (error.includes('Timed out') || error.includes('timeout')) {
        return 'timed-out';
    }
    return null;
}

export function sendPlayerErrorNotification(
    player: 'MPV' | 'VLC',
    error: string,
    code: ExternalPlayerErrorCode | null = classifyPlayerError(error)
): void {
    if (!App.mainWindow || App.mainWindow.isDestroyed()) {
        return;
    }

    const payload: ElectronBridgePlayerError = { player, code, error };
    App.mainWindow.webContents.send('player-error', payload);
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
