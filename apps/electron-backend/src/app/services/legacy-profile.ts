import { existsSync } from 'fs';
import { cp } from 'fs/promises';
import { join, resolve } from 'path';

/** v0.19 packaged package.json used Nx's project name, electron-backend. */
export function selectLegacyProfile(
    appData: string,
    current: string
): string | null {
    const legacy = join(appData, 'electron-backend');
    if (resolve(legacy) === resolve(current)) return null;
    // Any current Chromium persistence is authoritative, including an empty
    // playlist store after a user deliberately deleted their sources.
    if (
        ['IndexedDB', 'Local Storage', 'Preferences', 'config.json'].some(
            (entry) => existsSync(join(current, entry))
        )
    )
        return null;
    return existsSync(join(legacy, 'IndexedDB', 'file__0.indexeddb.leveldb'))
        ? legacy
        : null;
}

/** Materialize symlink targets so Chromium cannot write through to the original. */
export async function copyLegacyIndexedDb(
    profile: string,
    snapshot: string
): Promise<void> {
    await cp(join(profile, 'IndexedDB'), join(snapshot, 'IndexedDB'), {
        recursive: true,
        dereference: true,
    });
}
