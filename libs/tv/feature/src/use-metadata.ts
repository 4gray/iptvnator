import { useEffect, useMemo, useState } from 'preact/hooks';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { Media, UserData } from '@iptvnator/tv/util';

/** Provider data renders immediately; metadata can only patch its own selection. */
export function useMetadata(
    item: Media | undefined,
    settings: UserData['tmdb']
) {
    const client = useMemo(
        () => new TvMetadata(settings),
        [settings.enabled, settings.apiKey, settings.language]
    );
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState<{
        original: Media;
        client: TvMetadata;
        item: Media;
        failed: boolean;
    }>();
    useEffect(() => {
        const abort = new AbortController();
        if (item)
            void client
                .enrich(item, abort.signal)
                .then((value) => {
                    if (!abort.signal.aborted)
                        setResult({ original: item, client, ...value });
                })
                .catch(() => {
                    if (!abort.signal.aborted)
                        setResult({
                            original: item,
                            client,
                            item,
                            failed: true,
                        });
                });
        return () => abort.abort();
    }, [item, client, attempt]);
    const current =
        result?.original === item && result?.client === client
            ? result
            : undefined;
    return {
        item: current?.item ?? item,
        failed: current?.failed ?? false,
        retry: () => setAttempt((n) => n + 1),
        client,
    };
}
