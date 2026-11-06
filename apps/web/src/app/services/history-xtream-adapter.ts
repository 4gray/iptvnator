import { normalizeStalkerDate } from '@iptvnator/shared/interfaces';
import { XtreamCollectionCatalog } from './xtream-collection-catalog';
import type {
    IXtreamDataSource,
    XtreamRecentItem,
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
    private readonly catalogs = new XtreamCollectionCatalog(
        (id) => this.client.contexts.get(id)?.sourceIncarnation
    );
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
    ): Promise<XtreamRecentItem[]> {
        const scope = this.client.contexts.get(id);
        if (this.locks.withholdsEverything()) return [];
        const lockVersion = this.locks.version();
        let local = (
            await raw.getRecentItems(
                id,
                this.sqlite ? { all: true } : undefined
            )
        ).map((item) =>
            item.viewed_at
                ? { ...item, viewed_at: normalizeStalkerDate(item.viewed_at) }
                : item
        );
        if (this.sqlite && this.locks.active()) {
            const categories = await Promise.all(
                (['live', 'movies', 'series'] as const).map((kind) =>
                    raw.getAllCategories(id, kind)
                )
            );
            const allowed = new Set<number>();
            for (const rows of categories)
                for (const row of rows)
                    if (row.locked === false) allowed.add(row.id);
            local = local.filter((row) => allowed.has(Number(row.category_id)));
        }
        let state = await this.client.state(id);
        if (!state)
            return this.locks.withholdsEverything() ||
                this.locks.version() !== lockVersion
                ? []
                : this.sqlite
                  ? local.slice(0, 100)
                  : local;
        if (!this.sqlite) {
            const missing = new Set<'live' | 'movie' | 'series'>();
            const checked = new Set<'live' | 'movie' | 'series'>();
            for (const { reference } of visibleHistory(state)) {
                if (
                    reference.provider !== 'xtream' ||
                    checked.has(reference.kind)
                )
                    continue;
                checked.add(reference.kind);
                if (
                    !(await raw.getContentByXtreamId(
                        Number(reference.id),
                        id,
                        reference.kind
                    ))
                )
                    missing.add(reference.kind);
            }
            if (missing.size) {
                await Promise.all(
                    [...missing].map((kind) =>
                        this.catalogs.load(raw, id, kind)
                    )
                );
                this.client.current(scope);
                state = await this.client.state(id);
                if (!state) return local;
            }
        }
        const mapped = new Map(
            state.hideArchive
                ? []
                : local.map((item) => [
                      favoriteReferenceKey(xtreamFavoriteReference(item)),
                      item,
                  ])
        );
        for (const item of state.items)
            mapped.delete(favoriteReferenceKey(item.reference));
        let accepted = 0;
        for (const item of visibleHistory(state)) {
            const ref = item.reference;
            if (ref.provider !== 'xtream') continue;
            if (accepted === 100) break;
            if (item.snapshot?.identityConflict) continue;
            const key = favoriteReferenceKey(ref);
            const original = local.find(
                (row) =>
                    favoriteReferenceKey(xtreamFavoriteReference(row)) === key
            );
            let candidate: XtreamRecentItem | null | undefined = original;
            if (
                !original ||
                hasXtreamFavoriteIdentityConflict(item.snapshot, original)
            ) {
                const found = await raw.getContentByXtreamId(
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
                );
                if (
                    !original ||
                    (found &&
                        !hasXtreamFavoriteIdentityConflict(
                            item.snapshot,
                            found,
                            true
                        ))
                )
                    candidate = found;
            }
            if (
                ((!candidate || !String(candidate.category_id ?? '').trim()) &&
                    this.locks.active()) ||
                hasXtreamFavoriteIdentityConflict(item.snapshot, candidate)
            ) {
                mapped.delete(key);
                continue;
            }
            const unconfirmed = hasXtreamFavoriteIdentityConflict(
                item.snapshot,
                candidate,
                true
            );
            mapped.set(key, {
                ...(candidate ?? {
                    id: this.sqlite ? null : Number(ref.id),
                    category_id: '',
                    title: item.snapshot?.title ?? '',
                    rating: '',
                    added: '',
                    poster_url: '',
                    catalog_status: 'unknown',
                }),
                ...(unconfirmed
                    ? {
                          poster_url: '',
                          backdrop_url: undefined,
                          original_title: undefined,
                      }
                    : {}),
                ...(item.snapshot?.tmdbId
                    ? { tmdb_id: Number(item.snapshot.tmdbId) }
                    : {}),
                ...(item.snapshot?.releaseYear
                    ? { release_year: Number(item.snapshot.releaseYear) }
                    : {}),
                title: unconfirmed
                    ? (item.snapshot?.title ?? '')
                    : candidate?.title?.trim() || item.snapshot?.title || '',
                xtream_id: Number(ref.id),
                type: ref.kind,
                viewed_at: new Date(item.viewedAt).toISOString(),
            });
            accepted++;
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
                    (Date.parse(b.viewed_at ?? '') || 0) -
                    (Date.parse(a.viewed_at ?? '') || 0)
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
            .reduce<XtreamRecentItem[]>((all, rows) => all.concat(rows), [])
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
                method === 'getRecentItems' ||
                method === 'clearRecentItems' ||
                method === 'supportsPortableHistory'
                    ? 0
                    : 1
            ]
        );
        if (method === 'getRecentItems') return this.project(raw, id);
        if (method === 'supportsPortableHistory') {
            try {
                await this.client.scope(id);
                return true;
            } catch {
                this.client.current();
                return false;
            }
        }
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
