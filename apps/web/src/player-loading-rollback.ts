/** Temporary rollback for deferred player loading; remove by release 0.27. */
export const EAGER_PLAYER_LOADING_KEY = 'iptvnator.eagerPlayerLoading';

export function preparePlayerLoading(
    load: () => Promise<unknown> = () =>
        import('./eager-web-players').then((players) => players.ready),
    storage?: Pick<Storage, 'getItem'>
): Promise<unknown> | undefined {
    try {
        if (
            (storage ?? globalThis.localStorage)?.getItem(
                EAGER_PLAYER_LOADING_KEY
            ) !== '1'
        ) {
            return;
        }
    } catch {
        return; // Blocked storage keeps the default loading path.
    }
    // Await all engines before Angular bootstraps, rather than warming later.
    return load();
}
