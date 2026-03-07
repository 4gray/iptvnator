import { BrowserWindow } from 'electron';
import { PORTAL_DEBUG_EVENT, PortalDebugEvent } from 'shared-interfaces';
import { environment } from '../../environments/environment';

export function emitPortalDebugEvent(event: PortalDebugEvent): void {
    if (environment.production) {
        return;
    }

    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
        window.webContents.send(PORTAL_DEBUG_EVENT, event);
    }
}
