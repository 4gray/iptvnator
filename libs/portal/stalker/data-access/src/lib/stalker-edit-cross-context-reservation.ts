/** Holds one origin-wide edit reservation until persistence or cancellation. */
export async function acquireCrossContextEditReservation(
    playlistId: string
): Promise<() => void> {
    const locks = globalThis.navigator?.locks;
    if (!locks) {
        const isElectronRenderer =
            typeof window !== 'undefined' &&
            Boolean((window as Window & { electron?: unknown }).electron);
        if (typeof window === 'undefined' || isElectronRenderer) {
            return () => undefined;
        }
        throw new Error('Cross-context playlist edit locking is unavailable');
    }

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const acquired = new Promise<boolean>((resolve, reject) => {
        const request = locks.request(
            `iptvnator:stalker-edit:${playlistId}`,
            { ifAvailable: true, mode: 'exclusive' },
            async (lock) => {
                if (!lock) {
                    resolve(false);
                    return;
                }
                resolve(true);
                await held;
            }
        );
        void request.catch(reject);
    });

    if (!(await acquired)) {
        throw new Error('Stalker playlist edit already in progress');
    }

    let released = false;
    return () => {
        if (!released) {
            released = true;
            release();
        }
    };
}
