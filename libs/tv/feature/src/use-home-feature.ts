import { useMemo, useState } from 'preact/hooks';
import {
    continueWatching,
    seriesForEpisode,
    withSeriesContext,
    type Media,
} from '@iptvnator/tv/util';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import type { TvModel } from './use-tv';

/** Global selection survives source activation and detail/player return. */
export function useHomeFeature(tv: TvModel, beforeSelect: () => void) {
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
    const [selection, setSelection] = useState('');
    const index = Math.max(
        0,
        slides.findIndex((p) => p.item.id === selection)
    );
    const progress = slides[index];
    const original =
        progress?.item ??
        tv.data.favorites.find(
            (m) => m.kind === 'movie' || m.kind === 'series'
        ) ??
        tv.data.favorites[0] ??
        tv.home.find((m) => m.kind === 'movie') ??
        tv.home[0];
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
            if (slide && slide.item.id !== progress?.item.id) {
                beforeSelect();
                setSelection(slide.item.id);
            }
        },
    };
}
export type HomeFeature = ReturnType<typeof useHomeFeature>;
