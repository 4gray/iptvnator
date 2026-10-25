import { useEffect, useRef, useState } from 'preact/hooks';
import {
    NativePlayer,
    UserDataRepository,
    UserDataStorage,
} from '@iptvnator/tv/data-access';
import { initialData, recordProgress, UserData } from '@iptvnator/tv/util';
/** Persisted state is published only after its transaction commits. */
export function useUserData(
    video: { current: HTMLVideoElement | null },
    report: (message: string) => void,
    tick: () => void,
    saveFailure: (message: string, retry: () => Promise<void>) => void
) {
    const [data, setData] = useState(initialData);
    const [storageReady, setStorageReady] = useState(false);
    const [storageError, setStorageError] = useState('');
    const loading = useRef(false);
    const storage = useRef(new UserDataStorage());
    const repo = useRef<UserDataRepository>();
    const player = useRef<NativePlayer>();
    const callbacks = useRef({ report, tick, saveFailure });
    callbacks.current = { report, tick, saveFailure };
    if (!repo.current)
        repo.current = new UserDataRepository(storage.current, setData);
    const update = (change: (d: UserData) => UserData) =>
        repo.current!.update(change);
    async function retryStorage() {
        if (loading.current || storageReady) return;
        loading.current = true;
        setStorageError('');
        try {
            await repo.current!.load();
            setStorageReady(true);
        } catch {
            setStorageError(
                'Saved TV data could not be read. Your data has not been replaced. Free storage if needed, then retry.'
            );
        } finally {
            loading.current = false;
        }
    }
    useEffect(() => {
        void retryStorage();
        player.current = new NativePlayer(
            video.current!,
            (p) =>
                update((d) =>
                    (d.positions[p.item.id]?.updated ?? 0) > p.updated
                        ? d
                        : recordProgress(d, p)
                ),
            (message) => callbacks.current.report(message),
            () => callbacks.current.tick(),
            (message, retry) => callbacks.current.saveFailure(message, retry)
        );
        return () => {
            player.current?.dispose();
            storage.current.close();
        };
    }, []);
    return {
        data,
        storageReady,
        storageError,
        retryStorage,
        repo,
        player,
        update,
    };
}
