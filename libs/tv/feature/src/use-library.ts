import { useEffect, useRef, useState } from 'preact/hooks';
import {
    disconnectLibrary,
    LibraryError,
    mergeLibrary,
    ServerLibrary,
} from '@iptvnator/tv/data-access';
import { LatestRequest, type UserData } from '@iptvnator/tv/util';

export function useLibrary(
    data: UserData,
    ready: boolean,
    playing: boolean,
    update: (change: (data: UserData) => UserData) => Promise<void>
) {
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const latest = useRef({ data, playing, update });
    latest.current = { data, playing, update };
    const lane = useRef(new LatestRequest());
    const running = useRef(false);

    async function sync(url?: string, token?: string, sourceId?: string) {
        const snapshot = latest.current;
        if (snapshot.playing) {
            setError('Stop playback before refreshing the server library.');
            return;
        }
        const saved = snapshot.data.library;
        if (url === undefined && !saved) return;
        const job = lane.current.start();
        running.current = true;
        setBusy(true);
        setError('');
        setStatus('Connecting…');
        try {
            const client = new ServerLibrary(
                url ?? saved!.url,
                token ?? saved!.token,
                url === undefined ? saved!.instanceId : ''
            );
            const source = sourceId
                ? snapshot.data.sources.find(
                      (s) => s.id === sourceId && !s.libraryId
                  )
                : undefined;
            const result = source
                ? await client.upload(source, job.signal)
                : await client.read(job.signal);
            if (!lane.current.owns(job)) return;
            await latest.current.update((current) => {
                if (!lane.current.owns(job)) throw new Error('Cancelled');
                if (latest.current.playing)
                    throw new LibraryError(
                        'Library refresh deferred while playing. Saved sources are unchanged.'
                    );
                const same =
                    current.library?.instanceId ===
                        result.settings.instanceId &&
                    current.library.url === result.settings.url;
                return mergeLibrary(
                    same ? current : disconnectLibrary(current),
                    {
                        ...result.settings,
                        originals: same ? current.library!.originals : {},
                    },
                    result.sources
                );
            });
            if (lane.current.owns(job))
                setStatus(
                    `Connected · ${result.sources.length} server sources`
                );
        } catch (failure) {
            if (lane.current.owns(job)) {
                setStatus('Not synchronized');
                setError(
                    failure instanceof LibraryError
                        ? failure.message
                        : 'Library was not saved. Check TV storage and retry.'
                );
            }
        } finally {
            if (lane.current.owns(job)) {
                running.current = false;
                setBusy(false);
            }
        }
    }
    async function disconnect() {
        lane.current.cancel();
        running.current = false;
        setBusy(false);
        try {
            await latest.current.update(disconnectLibrary);
            setError('');
            setStatus('Disconnected. Sources remain on this TV.');
        } catch {
            setError('Library settings could not be saved.');
        }
    }
    const refresh = useRef(() => void sync());
    refresh.current = () => {
        if (
            !running.current &&
            !latest.current.playing &&
            document.visibilityState !== 'hidden'
        )
            void sync();
    };
    useEffect(() => {
        if (!ready) return;
        refresh.current();
        const visible = () => refresh.current();
        const timer = setInterval(visible, 60000);
        document.addEventListener('visibilitychange', visible);
        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', visible);
            lane.current.cancel();
            running.current = false;
        };
    }, [ready]);
    return {
        busy,
        status,
        error,
        connect: (url: string, token: string) => sync(url, token),
        refresh: () => sync(),
        upload: (sourceId: string) => sync(undefined, undefined, sourceId),
        disconnect,
    };
}
