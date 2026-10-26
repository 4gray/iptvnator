import { useEffect, useMemo, useState } from 'preact/hooks';
import {
    continueWatching,
    seriesForEpisode,
    withSeriesContext,
    type Media,
} from '@iptvnator/tv/util';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import type { TvModel } from './use-tv';

/** The selection survives detail/player return; another source starts at its latest title. */
export function useHomeFeature(tv: TvModel) {
    const history = useMemo(
        () =>
            continueWatching(tv.data).map((progress) => {
                const item = withSeriesContext(
                    progress.item,
                    seriesForEpisode(progress.item, [
                        ...tv.home,
                        ...tv.data.favorites,
                    ])
                );
                return item === progress.item
                    ? progress
                    : { ...progress, item };
            }),
        [tv.data.history, tv.data.activeId, tv.home, tv.data.favorites]
    );
    const slides = history.slice(0, 3);
    const [selection, setSelection] = useState({ sourceId: '', id: '' });
    useEffect(
        () => setSelection({ sourceId: tv.data.activeId, id: '' }),
        [tv.data.activeId]
    );
    const index =
        selection.sourceId === tv.data.activeId
            ? Math.max(
                  0,
                  slides.findIndex((p) => p.item.id === selection.id)
              )
            : 0;
    const progress = slides[index];
    const original =
        progress?.item ?? tv.home.find((m) => m.kind === 'movie') ?? tv.home[0];
    const parent =
        original &&
        seriesForEpisode(original, [...tv.home, ...tv.data.favorites]);
    const source = tv.data.sources.find((s) => s.id === original?.sourceId);
    const item = useMemo<Media | undefined>(() => {
        if (!original) return undefined;
        const saved = seriesForEpisode(original);
        const featured = parent ?? original;
        return {
            ...featured,
            poster: storedMediaPoster(original, source, [
                ...tv.home,
                ...tv.data.favorites,
            ]),
            backdrop: featured.backdrop || saved?.backdrop,
            year: featured.year || saved?.year,
            description: featured.description || saved?.description,
        };
    }, [original, parent, source]);
    return {
        item,
        progress,
        history,
        index,
        count: slides.length,
        select: (next: number) => {
            const slide = slides[(next + slides.length) % slides.length];
            if (slide)
                setSelection({ sourceId: tv.data.activeId, id: slide.item.id });
        },
    };
}
export type HomeFeature = ReturnType<typeof useHomeFeature>;
