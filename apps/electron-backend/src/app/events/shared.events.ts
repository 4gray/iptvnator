import { ipcMain } from 'electron';
import { configureRequestHeaderOverride } from '../services/request-header-overrides.service';

export default class SharedEvents {
    static bootstrapSharedEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle('set-user-agent', (_event, userAgent, referer, scopeUrl) => {
    setUserAgent(userAgent, referer, scopeUrl);
    return true;
});

/**
 * Sets scoped request headers for the currently selected stream.
 * @param userAgent user agent to use
 * @param referer referer to use
 * @param scopeUrl stream URL used to limit the override to the active origin
 */
export function setUserAgent(
    userAgent?: string | null,
    referer?: string | null,
    scopeUrl?: string | null
): void {
    configureRequestHeaderOverride(userAgent, referer, scopeUrl);
}
