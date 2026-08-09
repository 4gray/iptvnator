const PLAYLIST_AUTHORITY_BARRIER = 'iptvnator:playlist-authority';

export type PlaylistAuthorityReservation =
    | { readonly status: 'acquired'; readonly release: () => void }
    | { readonly status: 'busy' }
    | { readonly status: 'unavailable' };

function getLockManager(): LockManager | undefined {
    return globalThis.navigator?.locks;
}

function getPlaylistAuthorityLockName(playlistId: string): string {
    return `${PLAYLIST_AUTHORITY_BARRIER}:${playlistId}`;
}

async function runWithPlaylistRowLocks<T>(
    locks: LockManager,
    playlistIds: readonly string[],
    operation: () => Promise<T>,
    index = 0
): Promise<T> {
    if (index >= playlistIds.length) {
        return operation();
    }

    return locks.request(
        getPlaylistAuthorityLockName(playlistIds[index]),
        { mode: 'exclusive' },
        () => runWithPlaylistRowLocks(locks, playlistIds, operation, index + 1)
    );
}

/**
 * Coordinates row replacement operations with long-running Stalker Edit
 * discovery in every browser tab from the same origin.
 */
export async function runWithPlaylistAuthorityMutation<T>(
    playlistIds: readonly string[],
    operation: () => Promise<T>
): Promise<T> {
    const locks = getLockManager();
    if (!locks) {
        return operation();
    }
    const orderedIds = [...new Set(playlistIds.filter(Boolean))].sort();

    return locks.request(PLAYLIST_AUTHORITY_BARRIER, { mode: 'shared' }, () =>
        runWithPlaylistRowLocks(locks, orderedIds, operation)
    );
}

/** Prevents a store-wide clear from crossing any row-scoped reservation. */
export async function runWithPlaylistAuthorityReset<T>(
    operation: () => Promise<T>
): Promise<T> {
    const locks = getLockManager();
    if (!locks) {
        return operation();
    }

    return locks.request(
        PLAYLIST_AUTHORITY_BARRIER,
        { mode: 'exclusive' },
        operation
    );
}

/** Tries to hold one origin-wide row reservation until its owner releases it. */
export async function reservePlaylistAuthority(
    playlistId: string
): Promise<PlaylistAuthorityReservation> {
    const locks = getLockManager();
    if (!locks) {
        const isElectronRenderer =
            typeof window !== 'undefined' &&
            Boolean((window as Window & { electron?: unknown }).electron);
        if (typeof window === 'undefined' || isElectronRenderer) {
            return { status: 'acquired', release: () => undefined };
        }
        return { status: 'unavailable' };
    }

    let releaseHeldLock: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        releaseHeldLock = resolve;
    });
    const acquired = new Promise<boolean>((resolve, reject) => {
        const request = locks.request(
            PLAYLIST_AUTHORITY_BARRIER,
            { mode: 'shared' },
            () =>
                locks.request(
                    getPlaylistAuthorityLockName(playlistId),
                    { ifAvailable: true, mode: 'exclusive' },
                    async (lock) => {
                        if (!lock) {
                            resolve(false);
                            return;
                        }
                        resolve(true);
                        await held;
                    }
                )
        );
        void request.catch(reject);
    });

    if (!(await acquired)) {
        return { status: 'busy' };
    }

    let released = false;
    return {
        status: 'acquired',
        release: () => {
            if (!released) {
                released = true;
                releaseHeldLock();
            }
        },
    };
}

/** Holds one origin-wide Edit reservation until persistence or cancellation. */
export async function acquirePlaylistAuthorityEditReservation(
    playlistId: string
): Promise<() => void> {
    const reservation = await reservePlaylistAuthority(playlistId);
    if (reservation.status === 'acquired') {
        return reservation.release;
    }
    if (reservation.status === 'unavailable') {
        throw new Error('Cross-context playlist edit locking is unavailable');
    }
    throw new Error('Stalker playlist edit already in progress');
}
