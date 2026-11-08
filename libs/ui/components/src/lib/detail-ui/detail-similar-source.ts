import { InjectionToken, type Signal } from '@angular/core';
import { normalizeTitleKeys } from '@iptvnator/shared/interfaces';
import type { SimilarRailItem } from './similar-rail.component';

interface DetailSimilarSource {
    readonly items: Signal<readonly SimilarRailItem[]>;
    open(item: SimilarRailItem): void;
    rememberOrigin(): void;
}

/** An optional catalog owned by the host of a detail view. */
export const DETAIL_SIMILAR_SOURCE = new InjectionToken<DetailSimilarSource>(
    'DETAIL_SIMILAR_SOURCE'
);

export function mergeSimilarRailItems(
    local: readonly SimilarRailItem[],
    crossPortal: readonly SimilarRailItem[]
): readonly SimilarRailItem[] {
    if (!local.length) return crossPortal;
    const key = (item: SimilarRailItem) =>
        JSON.stringify([normalizeTitleKeys(item.title).exact, item.year]);
    const localTitles = new Set(local.map(key));
    return [
        ...local,
        ...crossPortal.filter((item) => !localTitles.has(key(item))),
    ];
}
