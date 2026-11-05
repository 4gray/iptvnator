import { useRef, useState } from 'preact/hooks';
import type { Route } from './navigation';

/** Keep season choice with its history entry, without retaining abandoned visits. */
export function useDetailSeason(route: Route) {
    const memory = useRef(new WeakMap<Route, number>());
    const [, refresh] = useState(0);
    return {
        season: memory.current.get(route),
        select(season: number) {
            memory.current.set(route, season);
            refresh((revision) => revision + 1);
        },
    };
}
