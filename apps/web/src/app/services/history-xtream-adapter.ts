import type {
    IXtreamDataSource,
    XtreamContentItem,
    XtreamCollectionRef,
    XtreamPlayedContent,
} from '@iptvnator/portal/xtream/data-access';
import type { HistorySyncClient } from '@iptvnator/services/history-sync';
import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import {
    visibleHistory,
    type HistoryReference,
} from '@iptvnator/shared/interfaces/history-sync';
import {
    xtreamFavoriteReference,
    xtreamFavoriteSnapshot,
    hasXtreamFavoriteIdentityConflict,
} from './favorites-reference-adapters';
export class HistoryXtreamAdapter {
    constructor(
        private readonly client: HistorySyncClient,
        private readonly sqlite: boolean,
        private readonly locks: {
            active(): boolean;
            withholdsEverything(): boolean;
            version(): number;
        }
    ) {}
    async project(
        raw: IXtreamDataSource,
        id: string
    ): Promise<XtreamContentItem[]> {
        const scope = this.client.contexts.get(id);
        if (this.locks.withholdsEverything()) return [];
        const lockVersion = this.locks.version();
        const local = await raw.getRecentItems(id);
        const state = await this.client.state(id);
        if (!state) return local;
        const mapped = new Map(
            state.hideArchive
                ? []
                : local.map((item) => [
                      favoriteReferenceKey(xtreamFavoriteReference(item)),
                      item,
                  ])
        );
        const active = new Set(
            visibleHistory(state)
                .slice(0, 100)
                .map((item) => favoriteReferenceKey(item.reference))
        );
        for (const item of state.items) {
            const ref = item.reference;
            if (ref.provider !== 'xtream') continue;
            const key = favoriteReferenceKey(ref);
            if (!active.has(key)) {
                mapped.delete(key);
                continue;
            }
            const candidate =
                local.find(
                    (row) =>
                        favoriteReferenceKey(xtreamFavoriteReference(row)) ===
                        key
                ) ??
                (await raw.getContentByXtreamId(
                    Number(ref.id),
                    id,
                    ref.kind,
                    {
                        tmdbId: item.snapshot?.tmdbId
                            ? Number(item.snapshot.tmdbId)
                            : undefined,
                        releaseYear: item.snapshot?.releaseYear
                            ? Number(item.snapshot.releaseYear)
                            : undefined,
                    },
                    undefined,
                    true
                ));
            if (
                (!candidate && this.locks.active()) ||
                hasXtreamFavoriteIdentityConflict(item.snapshot, candidate)
            ) {
                mapped.delete(key);
                continue;
            }
            mapped.set(key, {
                ...(candidate ?? {
                    id: Number(ref.id),
                    category_id: '',
                    title: item.snapshot?.title ?? '',
                    rating: '',
                    added: '',
                    poster_url: '',
                    catalog_status: 'unknown',
                }),
                xtream_id: Number(ref.id),
                type: ref.kind,
                viewed_at: new Date(item.viewedAt).toISOString(),
            });
        }
        this.client.current(scope);
        if (
            this.locks.withholdsEverything() ||
            this.locks.version() !== lockVersion
        )
            return [];
        return [...mapped.values()]
            .sort(
                (a, b) =>
                    new Date(b.viewed_at ?? '').getTime() -
                    new Date(a.viewed_at ?? '').getTime()
            )
            .slice(0, 100);
    }
    async reference(
        raw: IXtreamDataSource,
        id: string,
        target: XtreamCollectionRef
    ): Promise<Extract<HistoryReference, { provider: 'xtream' }>> {
        if (
            typeof target !== 'number' &&
            (target.providerId != null || !this.sqlite)
        )
            return xtreamFavoriteReference({
                type: target.type,
                xtream_id: target.providerId ?? target.id,
            });
        const rowId = typeof target === 'number' ? target : target.id;
        const candidates = (await raw.getRecentItems(id)).filter(
            (row) =>
                row.id === rowId &&
                (typeof target === 'number' || row.type === target.type)
        );
        if (candidates.length === 1)
            return xtreamFavoriteReference(candidates[0]);
        const rows = (
            await Promise.all(
                (typeof target === 'number'
                    ? (['live', 'movie', 'series'] as const)
                    : [target.type]
                ).map((type) => raw.getCachedContent(id, type))
            )
        )
            .reduce<XtreamContentItem[]>((all, rows) => all.concat(rows), [])
            .filter((row) => row.id === rowId);
        if (rows.length !== 1) throw new Error('History identity unavailable');
        return xtreamFavoriteReference(rows[0]);
    }
    async invoke(
        raw: IXtreamDataSource,
        method: string,
        args: unknown[]
    ): Promise<unknown> {
        const id = String(
            args[
                method === 'getRecentItems' || method === 'clearRecentItems'
                    ? 0
                    : 1
            ]
        );
        if (method === 'getRecentItems') return this.project(raw, id);
        const generation = this.client.options.consent();
        let scope;
        try {
            scope = await this.client.scope(id);
        } catch {
            this.client.current();
            return Reflect.get(raw, method).apply(raw, args);
        }
        if (method === 'clearRecentItems')
            return this.client.command(
                id,
                { kind: 'clear' },
                this.client.options.consent() !== generation
            );
        const reference = await this.reference(
            raw,
            id,
            args[0] as XtreamCollectionRef
        );
        const content = await raw.getContentByXtreamId(
            Number(reference.id),
            id,
            reference.kind
        );
        const played = args[3] as XtreamPlayedContent | undefined;
        const snapshot = xtreamFavoriteSnapshot({
            title: played?.title ?? content?.title ?? '',
            tmdb_id: played?.tmdbId ?? content?.tmdb_id,
            release_year: played?.releaseYear ?? content?.release_year,
            catalog_missing_reason: content?.catalog_missing_reason,
        });
        this.client.current(scope);
        return this.client.command(
            id,
            {
                kind: method === 'addRecentItem' ? 'touch' : 'remove',
                reference,
                snapshot,
            },
            this.client.options.consent() !== generation
        );
    }
}
