/**
 * Lets the renderer clear the connectivity guard's memory of a portal host.
 *
 * The guard refuses requests to a host that just stopped answering, which is
 * wrong the moment the user says "try again" or hands over a portal address
 * that may now point somewhere else. Every such moment sends this, so nothing
 * has to wait out the guard's window.
 *
 * The host key is derived the same way the request path derives it — both
 * `normalizeXtreamServerUrl` and `buildStalkerRequestUrl` rebuild their URL
 * from `URL.origin`, so the authority a request ends up using is always the
 * authority of the URL stored on the playlist. `URL.host` also leaves any
 * `user:pass@` userinfo out, so no credential reaches the key or the log.
 */

import { ipcMain } from 'electron';
import { CONNECTIVITY_GUARD_RESET } from '@iptvnator/shared/interfaces';
import { resetGuardedHost } from '../util/host-connectivity-guard';

export function registerConnectivityGuardHandlers(): void {
    ipcMain.handle(
        CONNECTIVITY_GUARD_RESET,
        async (_event, payload: { url?: string } | undefined) => {
            const url = payload?.url;
            if (!url) {
                return { success: false };
            }

            return { success: resetGuardedHost(url) };
        }
    );
}
