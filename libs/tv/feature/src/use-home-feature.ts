import { useEffect, useMemo, useState } from 'preact/hooks';
import { continueWatching, type Media } from '@iptvnator/tv/util';
import { storedMediaPoster } from '@iptvnator/tv/data-access';
import type { TvModel } from './use-tv';

/** The selection survives detail/player return; another source starts at its latest title. */
export function useHomeFeature(tv: TvModel) {
    const history = useMemo(
        () => continueWatching(tv.data),
        [tv.data.history, tv.data.activeId]
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
    const parent = [...tv.home, ...tv.data.favorites].find(
        (m) => m.id === original?.parentId
    );
    const source = tv.data.sources.find((s) => s.id === original?.sourceId);
    const item = useMemo<Media | undefined>(() => {
        if (!original) return undefined;
        return {
            ...original,
            seriesTitle: original.seriesTitle || parent?.title,
            seriesYear: original.seriesYear || parent?.year,
            poster: storedMediaPoster(original, source) || parent?.poster,
            backdrop: original.backdrop || parent?.backdrop,
            description: original.description || parent?.description,
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
