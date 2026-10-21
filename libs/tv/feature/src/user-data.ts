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
    tick: () => void
) {
    const [data, setData] = useState(initialData);
    const [storageReady, setStorageReady] = useState(false);
    const storage = useRef(new UserDataStorage());
    const repo = useRef<UserDataRepository>();
    const player = useRef<NativePlayer>();
    if (!repo.current)
        repo.current = new UserDataRepository(storage.current, setData);
    const update = (change: (d: UserData) => UserData) =>
        repo.current!.update(change);
    useEffect(() => {
        repo.current!.load()
            .then(() => setStorageReady(true))
            .catch(() =>
                report(
                    'Local TV storage is unavailable. Reload after freeing storage.'
                )
            );
        player.current = new NativePlayer(
            video.current!,
            (p) => update((d) => recordProgress(d, p)),
            report,
            tick
        );
        return () => {
            player.current?.dispose();
            storage.current.close();
        };
    }, []);
    return { data, storageReady, repo, player, update };
}
