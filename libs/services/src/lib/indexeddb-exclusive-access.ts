/**
 * A version upgrade waits for every earlier connection to close. Only the
 * upgrader owns the operation; another opener of that version retries above it.
 * Use a dedicated database so the operation can access application storage.
 * Closing/crashing a tab releases its connection without a lease or a timer.
 */
export async function withIndexedDbExclusiveAccess<T>(
    name: string,
    operation: () => Promise<T>
): Promise<T> {
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
