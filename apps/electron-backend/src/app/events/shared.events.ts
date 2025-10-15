import { ipcMain, session } from 'electron';

export default class SharedEvents {
    static bootstrapSharedEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle('set-user-agent', (event, userAgent, referer) => {
    setUserAgent(userAgent, referer); // TODO: test if defaults needed
    return true;
});

/**
 * Sets the user agent header for all http requests
 * @param userAgent user agent to use
 * @param referer referer to use
 */
export function setUserAgent(userAgent: string, referer?: string): void {
    if (userAgent === undefined || userAgent === null || userAgent === '') {
        userAgent = this.defaultUserAgent;
    }

    // Remove trailing slash from referer if it exists
    let originURL: string;
    if (referer?.endsWith('/')) {
        originURL = referer.slice(0, -1);
    }

    session.defaultSession.webRequest.onBeforeSendHeaders(
        (details, callback) => {
            details.requestHeaders['User-Agent'] = userAgent;
            details.requestHeaders['Referer'] = referer as string;
            details.requestHeaders['Origin'] = originURL as string;
            callback({ requestHeaders: details.requestHeaders });
        }
    );
    console.log(`Success: Set "${userAgent}" as user agent header`);
}
