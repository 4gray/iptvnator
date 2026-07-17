import { ipcMain, webContents, type WebContents } from 'electron';
import {
    LOCAL_TIMESHIFT_GET_SUPPORT,
    LOCAL_TIMESHIFT_SESSION_UPDATE,
    LOCAL_TIMESHIFT_START,
    LOCAL_TIMESHIFT_STOP,
    type LocalTimeshiftSession,
    type ResolvedPortalPlayback,
    type StartLocalTimeshiftRequest,
} from '@iptvnator/shared/interfaces';
import { LocalTimeshiftService } from '../services/local-timeshift.service';

const service = new LocalTimeshiftService();
const publicSessions = new Map<string, LocalTimeshiftSession>();
const publicSessionOwners = new Map<string, string>();
const ownersWithCleanup = new WeakSet<WebContents>();

service.setFailureHandler(({ sessionId, ownerId, error }) => {
    const previous = publicSessions.get(sessionId);
    publicSessions.delete(sessionId);
    publicSessionOwners.delete(sessionId);
    if (!previous) {
        return;
    }
    const sender = webContents.fromId(Number(ownerId));
    if (!sender || sender.isDestroyed()) {
        return;
    }
    sender.send(LOCAL_TIMESHIFT_SESSION_UPDATE, {
        ...previous,
        status: 'error',
        updatedAt: new Date().toISOString(),
        error: error.message,
    } satisfies LocalTimeshiftSession);
});

export default class LocalTimeshiftEvents {
    static bootstrapLocalTimeshiftEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle(LOCAL_TIMESHIFT_GET_SUPPORT, async () => service.getSupport());

ipcMain.handle(
    LOCAL_TIMESHIFT_START,
    async (event, request: StartLocalTimeshiftRequest) => {
        validateStartRequest(request);
        registerOwnerCleanup(event.sender);
        const snapshot = await service.start({
            ownerId: String(event.sender.id),
            sourceUrl: request.playback.streamUrl,
            requestHeaders: playbackHeaders(request.playback),
            maxDurationMinutes: request.maxDurationMinutes,
            bufferDirectory: request.bufferDirectory?.trim() || undefined,
        });
        const session: LocalTimeshiftSession = snapshot;
        publicSessions.set(session.id, session);
        publicSessionOwners.set(session.id, String(event.sender.id));
        return session;
    }
);

ipcMain.handle(LOCAL_TIMESHIFT_STOP, async (event, sessionId?: string) => {
    const ownerId = String(event.sender.id);
    if (!sessionId) {
        // The renderer is abandoning everything it owns, so drop its public
        // session entries as well; otherwise every channel change without a
        // public id leaks one entry until the renderer is destroyed.
        purgeOwnerSessions(ownerId);
        await service.stopForOwner(ownerId);
        return null;
    }
    const previous = await service.getSession(sessionId, ownerId);
    if (!previous) {
        publicSessions.delete(sessionId);
        publicSessionOwners.delete(sessionId);
        return null;
    }
    await service.stop(sessionId, ownerId);
    publicSessions.delete(sessionId);
    publicSessionOwners.delete(sessionId);
    return {
        ...previous,
        status: 'closed',
        updatedAt: new Date().toISOString(),
    } satisfies LocalTimeshiftSession;
});

function registerOwnerCleanup(sender: WebContents): void {
    if (ownersWithCleanup.has(sender)) {
        return;
    }
    ownersWithCleanup.add(sender);
    sender.once('destroyed', () => {
        const ownerId = String(sender.id);
        purgeOwnerSessions(ownerId);
        void service.stopForOwner(ownerId);
    });
}

function purgeOwnerSessions(ownerId: string): void {
    for (const [sessionId, sessionOwnerId] of publicSessionOwners) {
        if (sessionOwnerId === ownerId) {
            publicSessions.delete(sessionId);
            publicSessionOwners.delete(sessionId);
        }
    }
}

function validateStartRequest(request: StartLocalTimeshiftRequest): void {
    if (!request?.playback || request.playback.isLive !== true) {
        throw new Error('Local timeshift requires live playback');
    }
    if (
        !Number.isInteger(request.maxDurationMinutes) ||
        request.maxDurationMinutes < 5 ||
        request.maxDurationMinutes > 180
    ) {
        throw new Error('Local timeshift duration must be 5 to 180 minutes');
    }
    let protocol: string;
    try {
        protocol = new URL(request.playback.streamUrl).protocol;
    } catch {
        throw new Error('Local timeshift stream URL is invalid');
    }
    if (
        !['http:', 'https:', 'rtmp:', 'rtmps:', 'rtsp:', 'udp:'].includes(
            protocol
        )
    ) {
        throw new Error('Local timeshift stream protocol is not supported');
    }
}

function playbackHeaders(
    playback: ResolvedPortalPlayback
): Record<string, string> {
    const headers = { ...(playback.headers ?? {}) };
    setHeaderIfMissing(headers, 'User-Agent', playback.userAgent);
    setHeaderIfMissing(headers, 'Referer', playback.referer);
    setHeaderIfMissing(headers, 'Origin', playback.origin);
    return headers;
}

function setHeaderIfMissing(
    headers: Record<string, string>,
    name: string,
    value: string | undefined
): void {
    if (
        value &&
        !Object.keys(headers).some(
            (existing) => existing.toLowerCase() === name.toLowerCase()
        )
    ) {
        headers[name] = value;
    }
}

export async function shutdownLocalTimeshift(): Promise<void> {
    publicSessions.clear();
    publicSessionOwners.clear();
    await service.shutdown();
}
