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

/** A restore stays parked until the server accepted its lists without a merged conflict. */
export async function confirmPwaRestore(
    storage: UserDataStorage,
    playlistId: string,
    lists: () => unknown[]
): Promise<void> {
    const expected = JSON.stringify(lists());
    if ((await storage.flushed?.(playlistId)) === false)
        throw new Error(
            'The server did not take the restored lists; the restore waits.'
        );
    if (JSON.stringify(lists()) !== expected)
        throw new Error(
            'The lists changed elsewhere during the restore; it runs again.'
        );
}
