import type { ElectronBridgeAppMenuAction } from '@iptvnator/shared/interfaces';
import { APP_MENU_ACTION } from '@iptvnator/shared/interfaces';

/** Capture menu clicks before Angular boots; only the latest pending command matters. */
export function createAppMenuListener(ipc: Pick<Electron.IpcRenderer, 'on'>) {
    let pending: ElectronBridgeAppMenuAction | null = null;
    let listener: ((action: ElectronBridgeAppMenuAction) => void) | null = null;
    ipc.on(APP_MENU_ACTION, (_event, action: unknown) => {
        if (action !== 'settings' && action !== 'check-for-updates') return;
        if (listener) listener(action);
        else pending = action;
    });
    return (callback: (action: ElectronBridgeAppMenuAction) => void) => {
        listener = callback;
        if (pending) {
            const action = pending;
            pending = null;
            callback(action);
        }
        return () => {
            if (listener === callback) listener = null;
        };
    };
}
