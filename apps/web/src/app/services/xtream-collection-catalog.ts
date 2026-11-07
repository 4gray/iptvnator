import type {
    IXtreamDataSource,
    XtreamContentItem,
} from '@iptvnator/portal/xtream/data-access';
/** Share in-flight typed catalog reads while the data source owns its cache and lock filtering. */
export class XtreamCollectionCatalog {
    private readonly hydrating = new Map<
        string,
        Promise<XtreamContentItem[]>
    >();
    constructor(
        private readonly incarnation: (id: string) => string | undefined
    ) {}
    async load(
        raw: IXtreamDataSource,
        sourceId: string,
        kind: 'live' | 'movie' | 'series'
    ): Promise<XtreamContentItem[]> {
        const key = JSON.stringify([
            sourceId,
            kind,
            this.incarnation(sourceId),
        ]);
        let pending = this.hydrating.get(key);
        if (!pending) {
            pending = (async () => {
                const source = await raw.getPlaylist(sourceId);
                if (!source) return [];
                return (await raw.getContent(
                    sourceId,
                    {
                        serverUrl: source.serverUrl,
                        username: source.username,
                        password: source.password,
                        userAgent: source.userAgent?.trim() || undefined,
                    },
                    kind
                )) as XtreamContentItem[];
            })()
                .catch(() => [])
                .finally(() => this.hydrating.delete(key));
            this.hydrating.set(key, pending);
        }
        return pending;
    }
}
