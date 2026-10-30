import { useEffect, useState } from 'preact/hooks';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { TmdbPersonDetails } from '@iptvnator/shared/tmdb';

export function usePerson(id: number | undefined, client: TvMetadata) {
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState<{
        id: number;
        client: TvMetadata;
        person: TmdbPersonDetails | null;
    }>();
    useEffect(() => {
        const abort = new AbortController();
        if (id)
            void client
                .getPerson(id, abort.signal)
                .then((person) => {
                    if (!abort.signal.aborted)
                        setResult({ id, client, person });
                })
                .catch(() => {
                    if (!abort.signal.aborted)
                        setResult({ id, client, person: null });
                });
        return () => abort.abort();
    }, [id, client, attempt]);
    const current =
        result?.id === id && result?.client === client ? result : undefined;
    return {
        person: current?.person,
        loading: !!id && !current,
        retry: () => setAttempt((n) => n + 1),
    };
}
