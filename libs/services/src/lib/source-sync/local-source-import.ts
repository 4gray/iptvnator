import type { Playlist } from '@iptvnator/shared/interfaces';

export async function readLocalSourcesForImport(): Promise<Playlist[]> {
    if (window.electron?.sourceSyncLocalSources)
        return window.electron.sourceSyncLocalSources();
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('iptvnator');
        request.onupgradeneeded = () => {
            request.transaction?.abort();
        };
        request.onerror = () =>
            request.error?.name === 'AbortError'
                ? resolve([])
                : reject(new Error('SOURCE_SYNC.IMPORT_FAILED'));
        request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('playlists')) {
                db.close();
                resolve([]);
                return;
            }
            const read = db
                .transaction('playlists', 'readonly')
                .objectStore('playlists')
                .getAll();
            read.onsuccess = () => {
                db.close();
                resolve(read.result);
            };
            read.onerror = () => {
                db.close();
                reject(new Error('SOURCE_SYNC.IMPORT_FAILED'));
            };
        };
    });
}
