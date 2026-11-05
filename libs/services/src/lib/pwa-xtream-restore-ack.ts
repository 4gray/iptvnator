import type { UserDataStorage } from './user-data-storage';

/** Server mode may still be unread or have edits waiting before a replacement. */
export async function preparePwaRestore(
    storage: UserDataStorage,
    playlistId?: string
): Promise<void> {
    if (playlistId === undefined) {
        if ((await storage.ready?.(true)) === false)
            throw new Error(
                "The server's user data could not be read yet; the restore waits."
            );
    } else if ((await storage.flushed?.(playlistId)) === false) {
        throw new Error(
            'Earlier changes to this playlist are not on the server yet; the restore waits.'
        );
    }
}
