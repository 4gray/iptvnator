/**
 * Bridges the main-process playlist open queue to the renderer.
 *
 * The renderer subscribes to `OPEN_FILE` and then announces itself with a
 * single invoke. That invoke carries no payload on purpose: everything —
 * including the files queued before the window existed — leaves the queue
 * through the same push, and only once the renderer acknowledges it. A
 * renderer that reloads or dies mid-flush therefore leaves its requests in the
 * queue, and the next one to announce itself receives them.
 */

import { ipcMain } from 'electron';
import {
    ACKNOWLEDGE_PLAYLIST_OPEN_REQUEST,
    ANNOUNCE_PLAYLIST_OPEN_LISTENER,
    OPEN_FILE,
} from '@iptvnator/shared/interfaces';
import { playlistOpenRequests } from '../services/playlist-open-request';

export default class PlaylistOpenEvents {
    static bootstrapPlaylistOpenEvents(): Electron.IpcMain {
        ipcMain.handle(
            ACKNOWLEDGE_PLAYLIST_OPEN_REQUEST,
            (_event, requestId: string): void => {
                playlistOpenRequests.acknowledge(requestId);
            }
        );

        ipcMain.handle(ANNOUNCE_PLAYLIST_OPEN_LISTENER, (event): void => {
            playlistOpenRequests.setDelivery((request) => {
                if (event.sender.isDestroyed()) {
                    return false;
                }

                try {
                    event.sender.send(OPEN_FILE, request);
                } catch {
                    // The WebContents went away between the check and the
                    // send; keep the request for the next renderer.
                    return false;
                }

                return true;
            });
        });

        return ipcMain;
    }
}
