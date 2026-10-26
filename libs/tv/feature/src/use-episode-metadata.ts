import { useEffect, useState } from 'preact/hooks';
import { TvMetadata } from '@iptvnator/tv/data-access';
import { Media } from '@iptvnator/tv/util';

/** Season requests share the selection's client/cache and cannot publish across navigation. */
export function useEpisodeMetadata(
    parent: Media | undefined,
    items: Media[],
    season: number | undefined,
    client: TvMetadata
) {
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState<{
        parent: Media;
        original: Media[];
        client: TvMetadata;
        season: number;
        items: Media[];
        failed: boolean;
    }>();
    useEffect(() => {
        const abort = new AbortController();
        if (season !== undefined && parent?.metadata)
            void client
                .enrichEpisodes(parent, items, season, abort.signal)
                .then((value) => {
                    if (!abort.signal.aborted)
                        setResult({
                            parent,
                            original: items,
                            client,
                            season,
                            ...value,
                        });
                })
                .catch(() => {
                    if (!abort.signal.aborted)
                        setResult({
                            parent,
                            original: items,
                            client,
                            season,
                            items,
                            failed: true,
                        });
                });
        return () => abort.abort();
    }, [parent, items, season, client, attempt]);
    const current =
        result?.parent === parent &&
        result?.original === items &&
        result?.client === client &&
        result?.season === season
            ? result
            : undefined;
    return {
        items: current?.items ?? items,
        failed: current?.failed ?? false,
        retry: () => setAttempt((n) => n + 1),
    };
}
