/**
 * A version upgrade waits for every earlier connection to close. Only the
 * upgrader owns cleanup; another opener of that same version retries above it.
 * Keep this separate from source/settings databases: hooks must access those.
 * Closing/crashing a tab releases its connection without a lease or a timer.
 */
export async function withIndexedDbCleanupOwnership<T>(
    profile: string,
    operation: () => Promise<T>
): Promise<T> {
    const name = `iptvnator-source-cleanup:${profile}`;
    let version: number | undefined;
    for (;;) {
        const claim = await new Promise<{
            database: IDBDatabase;
            owner: boolean;
        } | null>((resolve, reject) => {
            const open =
                version === undefined
                    ? indexedDB.open(name)
                    : indexedDB.open(name, version);
            let owner = false;
            open.onupgradeneeded = () => {
                owner = true;
            };
            open.onerror = () => {
                if (open.error?.name === 'VersionError') resolve(null);
                else reject(open.error);
            };
            open.onsuccess = () => resolve({ database: open.result, owner });
        });
        if (!claim) {
            version = undefined;
            continue;
        }
        const { database, owner } = claim;
        if (!owner) {
            version = database.version + 1;
            database.close();
            continue;
        }
        // Intentionally keep this connection open on versionchange. The next
        // claimant waits until this operation (including hooks) settles.
        try {
            return await operation();
        } finally {
            database.close();
        }
    }
}
