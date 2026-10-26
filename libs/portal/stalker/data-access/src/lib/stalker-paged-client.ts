export type StalkerWireRow = Record<string, unknown>;
export interface StalkerWirePage {
    data: StalkerWireRow[];
    total: number;
    pageSize: number;
}
type Sender = (
    params: Record<string, string | number>,
    signal: AbortSignal
) => Promise<unknown>;
/** Maps arbitrary portal page sizes into bounded client pages without skipping rows. */
export class StalkerPagedCatalog {
    private shapes = new Map<string, number>();
    private pages = new Map<string, StalkerWirePage>();
    constructor(private send: Sender) {}
    private async serverPage(
        params: Record<string, string | number>,
        page: number,
        signal: AbortSignal
    ) {
        const key = JSON.stringify([params, page]);
        const cached = this.pages.get(key);
        if (cached) return cached;
        const response = (await this.send(
            { ...params, action: 'get_ordered_list', p: page },
            signal
        )) as {
            js?:
                | {
                      data?: unknown;
                      total_items?: unknown;
                      max_page_items?: unknown;
                  }
                | unknown[];
        };
        const js = response?.js;
        const data = Array.isArray(js) ? js : js?.data;
        if (!Array.isArray(data))
            throw new Error('Invalid Stalker catalog response.');
        const rows = data.filter(
            (r) => r && typeof r === 'object'
        ) as StalkerWireRow[];
        const envelope = js as {
            total_items?: unknown;
            max_page_items?: unknown;
        };
        const result = {
            data: rows,
            total: Number(envelope?.total_items ?? rows.length),
            pageSize: Number(envelope?.max_page_items) || rows.length || 1,
        };
        if (!signal.aborted) {
            this.pages.set(key, result);
            if (this.pages.size > 4)
                this.pages.delete(this.pages.keys().next().value!);
        }
        return result;
    }
    async load(
        params: Record<string, string | number>,
        page: number,
        signal: AbortSignal
    ): Promise<StalkerWirePage> {
        const key = JSON.stringify(params);
        let serverSize = this.shapes.get(key);
        if (!serverSize) {
            const first = await this.serverPage(params, 1, signal);
            serverSize = first.pageSize;
            this.shapes.set(key, serverSize);
            if (this.shapes.size > 8)
                this.shapes.delete(this.shapes.keys().next().value!);
        }
        const pageSize = Math.min(60, serverSize);
        let offset = page * pageSize;
        const data: StalkerWireRow[] = [];
        let total = Infinity;
        while (data.length < pageSize && offset < total) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const response = await this.serverPage(
                params,
                Math.floor(offset / serverSize) + 1,
                signal
            );
            total = response.total;
            const slice = response.data.slice(
                offset % serverSize,
                (offset % serverSize) + pageSize - data.length
            );
            if (!slice.length) break;
            data.push(...slice);
            offset += slice.length;
        }
        return { data, total: Number.isFinite(total) ? total : 0, pageSize };
    }
    clear() {
        this.pages.clear();
        this.shapes.clear();
    }
}
