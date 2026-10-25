import { useEffect } from 'preact/hooks';
import { recoverSeriesContext } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';

export function useSeriesContext(tv: TvModel) {
    useEffect(() => {
        const parents = [
            ...tv.home,
            ...tv.catalog.items,
            ...tv.data.favorites,
            tv.selected,
        ];
        if (recoverSeriesContext(tv.data, parents) === tv.data) return;
        void tv
            .update((data) => recoverSeriesContext(data, parents))
            .catch(() => undefined);
    }, [
        tv.home,
        tv.catalog.items,
        tv.selected,
        tv.data.history,
        tv.data.favorites,
        tv.data.positions,
    ]);
}
