export interface StalkerSeriesPage<T> {
    js?:
        | T[]
        | {
              data?: T[];
              total_items?: number | string;
              max_page_items?: number | string;
              total_pages?: number | string;
          };
}

function count(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Collect a complete lazy season/episode list without trusting page-size overrides. */
export async function fetchStalkerSeriesPages<
    T extends { id: string | number },
>(
    request: (page: number) => Promise<StalkerSeriesPage<T>>,
    isCurrent: () => boolean
): Promise<T[]> {
    const items = new Map<string, T>();
    let total: number | undefined;
    let pages: number | undefined;
    // Fail rather than hang or publish a truncated list from a broken portal.
    for (let page = 1; page <= 1000; page++) {
        if (!isCurrent())
            throw new DOMException('Selection changed', 'AbortError');
        const response = await request(page);
        if (!isCurrent())
            throw new DOMException('Selection changed', 'AbortError');
        const js = response?.js;
        const rows = Array.isArray(js) ? js : js?.data;
        if (!Array.isArray(rows)) {
            throw new Error('Malformed Stalker season episodes response');
        }
        const envelope = Array.isArray(js) ? undefined : js;
        if (page === 1) {
            total = count(envelope?.total_items);
            pages = count(envelope?.total_pages);
        }
        if (rows.length === 0) {
            if (
                (total !== undefined && items.size < total) ||
                (pages !== undefined &&
                    page <= pages &&
                    (page > 1 || pages > 1))
            ) {
                throw new Error('Incomplete Stalker series list');
            }
            return [...items.values()];
        }
        const previousSize = items.size;
        for (const row of rows) {
            if (
                row?.id === undefined ||
                row.id === null ||
                String(row.id).trim() === ''
            ) {
                throw new Error('Malformed Stalker series item');
            }
            const id = String(row.id);
            if (!items.has(id)) items.set(id, row);
        }
        if (items.size === previousSize) {
            throw new Error('Stalker series pagination made no progress');
        }
        if (total !== undefined) {
            if (items.size >= total) return [...items.values()];
        } else if (pages) {
            if (page >= pages) return [...items.values()];
        } else {
            const pageSize = count(envelope?.max_page_items);
            // Legacy array replies and envelopes without paging metadata are complete.
            if (!pageSize || rows.length < pageSize) return [...items.values()];
        }
    }
    throw new Error('Stalker series pagination exceeded 1000 pages');
}
