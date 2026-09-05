import { app, BrowserWindow, dialog, session } from 'electron';
import { mkdtemp, rm, writeFile, access } from 'fs/promises';
import { copyLegacyIndexedDb } from './legacy-profile';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { getDatabase } from '../database/connection';
import { databaseWorkerClient } from './database-worker-client';
import { LEGACY_PROFILE_MIGRATION_KEY } from '../database/operations/playlist-migration.operations';

/** Read only a disposable copy: Chromium must never open the original LevelDB. */
export async function readLegacyProfilePlaylists(
    profile: string
): Promise<Record<string, unknown>[]> {
    const snapshot = await mkdtemp(
        join(tmpdir(), 'iptvnator-legacy-recovery-')
    );
    let reader: BrowserWindow | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await copyLegacyIndexedDb(profile, snapshot);
        const index = join(snapshot, 'index.html');
        await writeFile(
            index,
            '<!doctype html><title>Legacy playlist reader</title>'
        );
        reader = new BrowserWindow({
            show: false,
            webPreferences: {
                session: session.fromPath(snapshot),
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
        const read = reader.loadFile(index).then(() =>
            reader!.webContents
                .executeJavaScript(`new Promise((resolve, reject) => {
            const request = indexedDB.open('iptvnator', 1);
            request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Legacy database is absent')); };
            request.onerror = () => reject(new Error('Legacy database could not be opened'));
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('playlists')) { db.close(); reject(new Error('Legacy store is absent')); return; }
                const tx = db.transaction('playlists', 'readonly');
                const all = tx.objectStore('playlists').getAll();
                tx.oncomplete = () => { db.close(); resolve(all.result); };
                tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Legacy read failed')); };
            };
        })`)
        );
        return await Promise.race([
            read,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error('Legacy read timed out')),
                    15000
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
        reader?.destroy();
        // Chromium can keep the disposable session's files open on Windows.
        await rm(snapshot, {
            recursive: true,
            force: true,
            maxRetries: 3,
        }).catch(() => undefined);
    }
}

let recovery: Promise<void> | undefined;
export function recoverLegacyProfile(): Promise<void> {
    return (recovery ??= recover().catch(() => {
        recovery = undefined;
        console.warn(
            'Legacy profile recovery failed; original data was retained'
        );
        return dialog
            .showMessageBox({
                type: 'error',
                title: 'Legacy recovery could not finish',
                message:
                    'Your current sources are still available. Close the old IPTVnator version and restart to retry. The original data was retained.',
            })
            .then(() => undefined);
    }));
}

async function recover(): Promise<void> {
    const root =
        process.env.IPTVNATOR_E2E_DATA_DIR?.trim() || app.getPath('appData');
    const legacy = join(root, 'electron-backend');
    if (resolve(legacy) === resolve(app.getPath('userData'))) return;
    try {
        await access(join(legacy, 'IndexedDB', 'file__0.indexeddb.leveldb'));
    } catch {
        return;
    }
    await getDatabase();
    const state = await databaseWorkerClient.request<string | null>(
        'DB_GET_APP_STATE',
        { key: LEGACY_PROFILE_MIGRATION_KEY }
    );
    if (state === '1') return;
    if (
        state === 'declined' &&
        !app.commandLine.hasSwitch('recover-legacy-playlists')
    )
        return;
    const { response } = await dialog.showMessageBox({
        type: 'question',
        title: 'Recover legacy IPTVnator sources',
        message: 'An older IPTVnator profile was found.',
        detail: 'Recover all missing sources from this profile? This can also restore sources you intentionally deleted after upgrading. Existing sources and current settings will be kept. The original profile will not be erased. Close the old IPTVnator version before continuing.',
        buttons: ['Keep current sources', 'Recover all missing sources'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
    });
    if (response !== 1) {
        await databaseWorkerClient.request('DB_SET_APP_STATE', {
            key: LEGACY_PROFILE_MIGRATION_KEY,
            value: 'declined',
        });
        return;
    }
    const playlists = await readLegacyProfilePlaylists(legacy);
    await databaseWorkerClient.request('DB_MIGRATE_APP_PLAYLISTS', {
        playlists,
        key: LEGACY_PROFILE_MIGRATION_KEY,
    });
}
