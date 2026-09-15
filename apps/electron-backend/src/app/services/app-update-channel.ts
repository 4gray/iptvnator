import {
    AppUpdateChannel,
    normalizeAppUpdateChannel,
} from '@iptvnator/shared/interfaces';
import { APP_UPDATE_CHANNEL, store } from './store.service';

type AppUpdateChannelListener = (channel: AppUpdateChannel) => void;

const listeners = new Set<AppUpdateChannelListener>();

/**
 * The persisted update channel, read synchronously from the main-process
 * config so the startup update check can use it before any renderer exists.
 * Junk in the config file collapses to `stable`.
 */
export function readStoredAppUpdateChannel(): AppUpdateChannel {
    return normalizeAppUpdateChannel(store.get(APP_UPDATE_CHANNEL));
}

/**
 * Mirrors a saved `Settings.updateChannel` into the config file and tells
 * the updater. Listeners only run on an actual change, so a Save that keeps
 * the channel cannot restart an update check.
 */
export function persistAppUpdateChannel(value: unknown): AppUpdateChannel {
    const channel = normalizeAppUpdateChannel(value);
    const previous = readStoredAppUpdateChannel();

    store.set(APP_UPDATE_CHANNEL, channel);

    if (channel !== previous) {
        for (const listener of listeners) {
            listener(channel);
        }
    }

    return channel;
}

export function onAppUpdateChannelChange(
    listener: AppUpdateChannelListener
): () => void {
    listeners.add(listener);

    return () => {
        listeners.delete(listener);
    };
}
