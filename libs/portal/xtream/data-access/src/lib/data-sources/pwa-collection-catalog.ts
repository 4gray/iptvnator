import {
    typedCollectionRef,
    type CollectionKey,
} from './pwa-collection-identity';
import type { XtreamContentItem } from './xtream-data-source.interface';

/** Index only requested provider IDs, retaining every typed/category duplicate. */
export class PwaCollectionCatalog {
    private readonly indexes = new WeakMap<
        readonly XtreamContentItem[],
        {
            requested: Set<number>;
            rows: Map<number, XtreamContentItem[]>;
        }
    >();

    select(
        catalog: readonly XtreamContentItem[],
        keys: readonly CollectionKey[]
    ): XtreamContentItem[] {
        const wanted = new Set(
            keys.map((key) => typedCollectionRef(key)?.id ?? Number(key))
        );
        let index = this.indexes.get(catalog);
        if (!index) {
            index = { requested: new Set(), rows: new Map() };
            this.indexes.set(catalog, index);
        }
        const missing = new Set(
            [...wanted].filter((id) => !index.requested.has(id))
        );
        if (missing.size) {
            for (const row of catalog) {
                if (!row || !missing.has(row.xtream_id)) continue;
                const rows = index.rows.get(row.xtream_id) ?? [];
                rows.push(row);
                index.rows.set(row.xtream_id, rows);
            }
            for (const id of missing) index.requested.add(id);
        }
        const selected: XtreamContentItem[] = [];
        for (const id of wanted)
            for (const row of index.rows.get(id) ?? []) selected.push(row);
        return selected;
    }
}
