import { useState } from 'preact/hooks';
import { normalizeCatalogSort } from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function CatalogOrder({
    tv,
    kind,
}: {
    tv: TvModel;
    kind: 'movie' | 'series';
}) {
    const [saving, setSaving] = useState(false);
    const sort = tv.data.catalogSort[kind];
    return (
        <label>
            Sort by
            <select
                aria-label="Sort by"
                data-focus="catalog-sort"
                value={sort}
                disabled={saving}
                onChange={async (event) => {
                    const control = event.currentTarget;
                    const next = normalizeCatalogSort(
                        event.currentTarget.value
                    );
                    setSaving(true);
                    try {
                        await tv.update((data) => ({
                            ...data,
                            catalogSort: { ...data.catalogSort, [kind]: next },
                        }));
                        document.querySelector('main')?.scrollTo(0, 0);
                    } catch {
                        tv.setError(
                            'Sort order was not saved. Free TV storage and retry.'
                        );
                    } finally {
                        setSaving(false);
                        requestAnimationFrame(() => {
                            if (
                                control.isConnected &&
                                document.activeElement === document.body
                            )
                                control.focus();
                        });
                    }
                }}
            >
                <option value="recent">Recently added</option>
                <option value="title">Title · A–Z</option>
                <option value="provider">Provider order</option>
            </select>
        </label>
    );
}
export function CatalogSortNotice({ tv }: { tv: TvModel }) {
    const kind = tv.route.kind;
    if (
        (kind !== 'movie' && kind !== 'series') ||
        tv.data.catalogSort[kind] !== 'recent'
    )
        return null;
    const provider = tv.data.sources.find(
        (s) => s.id === tv.data.activeId
    )?.provider;
    const message =
        provider === 'm3u'
            ? 'No added dates in M3U; playlist order is used.'
            : provider === 'xtream' && kind === 'series'
              ? 'Uses update dates when added dates are unavailable.'
              : '';
    return message ? <p class="muted">{message}</p> : null;
}
