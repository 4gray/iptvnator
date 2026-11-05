import { ipcMain } from 'electron';
import {
    configureRequestHeaderOverride,
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

ipcMain.handle(
    'set-user-agent',
    (_event, userAgent, referer, scopeUrl, credentials, origin) => {
        setUserAgent(
            userAgent,
            referer,
            scopeUrl,
            sanitizeCredentials(credentials),
            origin
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
 */
export function setUserAgent(
    userAgent?: string | null,
    referer?: string | null,
    scopeUrl?: string | null,
    credentials?: StreamCredentialHeaders | null,
    origin?: string | null
): void {
    configureRequestHeaderOverride(
        userAgent,
        referer,
        scopeUrl,
        credentials,
        origin
    );
}
