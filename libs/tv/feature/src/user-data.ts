import { useEffect, useRef, useState } from 'preact/hooks';
import { useProgressSaveNotice } from './use-notice';
import { installTvScreensaver, restoreFocus } from '@iptvnator/tv/ui';
import {
    NativePlayer,
    UserDataRepository,
    UserDataStorage,
} from '@iptvnator/tv/data-access';
import {
    ConfirmedLiveChannels,
    initialData,
    recordProgress,
    setWatchState,
    type WatchAction,
    UserData,
    Media,
} from '@iptvnator/tv/util';
/** Persisted state is published only after its transaction commits. */
export function useUserData(
    video: { current: HTMLVideoElement | null },
    report: (message: string) => void,
    tick: () => void,
    favoriteNotice: {
        setError: (message: string, retry?: () => void, label?: string) => void;
        clearError: (label: string) => void;
    }
) {
    const [data, setData] = useState(initialData);
    const [storageReady, setStorageReady] = useState(false);
    const [storageError, setStorageError] = useState('');
    const loading = useRef(false);
    const storage = useRef(new UserDataStorage());
    const repo = useRef<UserDataRepository>();
    const player = useRef<NativePlayer>();
    const liveChannels = useRef(new ConfirmedLiveChannels());
    const progressSaveNotice = useProgressSaveNotice();
    const callbacks = useRef({ report, tick, progressSaveNotice });
    callbacks.current = { report, tick, progressSaveNotice };
    if (!repo.current)
        repo.current = new UserDataRepository(storage.current, setData);
    const update = (change: (d: UserData) => UserData) =>
        repo.current!.update(change);
    async function updateProgress(
        itemId: string,
        change: (d: UserData) => UserData
    ) {
        await update(change);
        callbacks.current.progressSaveNotice.saved(
            repo.current?.data.positions[itemId]
        );
    }
    const saveWatch = (item: Media, action: WatchAction) =>
        updateProgress(item.id, (d) => setWatchState(d, item, action));
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
        const removeScreensaver = installTvScreensaver(video.current!);
        player.current = new NativePlayer(
            video.current!,
            (p) =>
                updateProgress(p.item.id, (d) =>
                    d.sources.some((source) => source.id === p.item.sourceId)
                        ? recordProgress(d, p)
                        : d
                ),
            (message) => callbacks.current.report(message),
            () => callbacks.current.tick(),
            (message, retry, progress) =>
                callbacks.current.progressSaveNotice.report(
                    message,
                    retry,
                    progress
                ),
            (item) =>
                liveChannels.current.confirm(item, repo.current!.data.sources)
        );
        return () => {
            player.current?.dispose();
            removeScreensaver();
            storage.current.close();
        };
    }, []);
    async function favorite(item: Media) {
        try {
            await update((d) => ({
                ...d,
                favorites: d.favorites.some((m) => m.id === item.id)
                    ? d.favorites.filter((m) => m.id !== item.id)
                    : [...d.favorites, item],
            }));
            favoriteNotice.clearError('Retry saving favorite');
        } catch {
            favoriteNotice.setError(
                'Favorite was not saved. Free TV storage and retry.',
                () => void favorite(item),
                'Retry saving favorite'
            );
        }
    }
    async function watch(
        item: Media,
        action: WatchAction,
        returnFocus?: string
    ) {
        const retryLabel = 'Retry viewing status';
        try {
            await saveWatch(item, action);
            favoriteNotice.clearError(retryLabel);
            favoriteNotice.clearError('Retry start over');
            return true;
        } catch {
            favoriteNotice.setError(
                'Viewing status was not saved. Free TV storage and retry.',
                () =>
                    void watch(item, action, returnFocus).then((saved) => {
                        if (
                            saved &&
                            returnFocus &&
                            document.activeElement === document.body
                        )
                            restoreFocus(returnFocus, 'hero-resume');
                    }),
                retryLabel
            );
            return false;
        }
    }
    return {
        data,
        progressSaveNotice,
        storageReady,
        storageError,
        retryStorage,
        repo,
        player,
        update,
        favorite,
        watch,
        saveWatch,
        previousChannel: liveChannels.current.previous(data.sources),
    };
}
