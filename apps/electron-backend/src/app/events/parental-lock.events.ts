import { ipcMain, WebContents } from 'electron';
import { PARENTAL_LOCK_SET_STATE } from '@iptvnator/shared/interfaces';
import { databaseWorkerClient } from '../services/database-worker-client';
import {
    getParentalLockActive,
    setParentalLockActiveState,
} from '../services/parental-lock-state';
import { PARENTAL_LOCK_ENABLED, store } from '../services/store.service';

/**
 * Parental lock IPC.
 *
 * The renderer reports whether locked categories must be withheld (feature
 * enabled and no PIN entered). The value is kept in the main process and
 * pushed into the SQLite worker, which filters every content read on it.
 *
 * Like the playback keep-awake vote, the renderer's word must not outlive the
 * page that gave it: on reload, navigation or a dead render process the flag
 * falls back to the mirrored `parentalLockEnabled` setting, i.e. locked
 * while the feature is on. A crashed page can therefore never leave the
 * library unlocked.
 */

const senderCleanups = new Map<number, () => void>();

export async function applyParentalLockState(active: boolean): Promise<void> {
    setParentalLockActiveState(active);
    try {
        await databaseWorkerClient.setParentalLockState(
            getParentalLockActive()
        );
    } catch (error) {
        console.error('Failed to update parental lock state:', error);
        throw error;
    }
}

/** The state a renderer that has not announced itself yet must get. */
export function defaultParentalLockState(): boolean {
    return store.get(PARENTAL_LOCK_ENABLED, false) === true;
}

function watchSenderLifetime(sender: WebContents): void {
    const senderId = sender.id;
    if (senderCleanups.has(senderId)) {
        return;
    }
    const relock = () => {
        void applyParentalLockState(defaultParentalLockState()).catch(
            () => undefined
        );
    };
    const onNavigation = (
        event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>
    ) => {
        if (event.isMainFrame && !event.isSameDocument) {
            relock();
        }
    };
    const onDestroyed = () => {
        relock();
        senderCleanups.get(senderId)?.();
        senderCleanups.delete(senderId);
    };
    sender.on('destroyed', onDestroyed);
    sender.on('render-process-gone', relock);
    sender.on('did-start-navigation', onNavigation);
    senderCleanups.set(senderId, () => {
        sender.off('destroyed', onDestroyed);
        sender.off('render-process-gone', relock);
        sender.off('did-start-navigation', onNavigation);
    });
}

export default class ParentalLockEvents {
    static bootstrapParentalLockEvents(): Electron.IpcMain {
        setParentalLockActiveState(defaultParentalLockState());
        return ipcMain;
    }
}

ipcMain.handle(PARENTAL_LOCK_SET_STATE, async (event, active: boolean) => {
    watchSenderLifetime(event.sender);
    await applyParentalLockState(active === true);
});
