import { ipcMain } from 'electron';
import {
    configureRequestHeaderOverride,
    releaseRequestHeaderOwner,
    type StreamCredentialHeaders,
} from '../services/request-header-overrides.service';

export default class SharedEvents {
    static bootstrapSharedEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

function sanitizeCredentials(value: unknown): StreamCredentialHeaders | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const { cookie, authorization } = value as Record<string, unknown>;
    return {
        authorization:
            typeof authorization === 'string' ? authorization : undefined,
        cookie: typeof cookie === 'string' ? cookie : undefined,
    };
}

/** Owner ids are short renderer-chosen labels; anything else is ignored. */
function sanitizeOwnerId(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length <= 128
        ? value
        : undefined;
}

/** A multiview tile's player is gone: forget its header owner. */
ipcMain.handle('release-header-owner', (_event, ownerId) => {
    const owner = sanitizeOwnerId(ownerId);
    if (owner) releaseRequestHeaderOwner(owner);
    return true;
});

ipcMain.handle(
    'set-user-agent',
    (_event, userAgent, referer, scopeUrl, credentials, origin, ownerId) => {
        setUserAgent(
            userAgent,
            referer,
            scopeUrl,
            sanitizeCredentials(credentials),
            origin,
            sanitizeOwnerId(ownerId)
        );
        return true;
    }
);

/**
 * Sets scoped request headers for the currently selected stream.
 * @param userAgent user agent to use
 * @param referer referer to use
 * @param scopeUrl stream URL used to limit the override to the active origin
 * @param credentials portal Cookie/Authorization for auth-gated streams;
 *   applied only to the exact origin of `scopeUrl` and only while the
 *   scoped override is active
 * @param origin explicit Origin override; otherwise derived from referer
 * @param ownerId which scoped override to set or clear; omitted by every
 *   single-player surface, which then shares the default one
 */
export function setUserAgent(
    userAgent?: string | null,
    referer?: string | null,
    scopeUrl?: string | null,
    credentials?: StreamCredentialHeaders | null,
    origin?: string | null,
    ownerId?: string
): void {
    configureRequestHeaderOverride(
        userAgent,
        referer,
        scopeUrl,
        credentials,
        origin,
        ownerId
    );
}
