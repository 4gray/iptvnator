import { XtreamCollectionCatalog } from './xtream-collection-catalog';
import type {
    IXtreamDataSource,
    XtreamCollectionRef,
    XtreamFavoriteItem,
    XtreamContentItem,
} from '@iptvnator/portal/xtream/data-access';
import {
    favoriteReferenceKey,
    parseFavoriteSnapshot,
    type FavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    captureFavoriteOwner,
    type FavoritesSyncClient,
} from '@iptvnator/services/favorites-sync';
import {
    xtreamFavoriteReference,
    xtreamFavoriteSnapshot,
    hasXtreamFavoriteIdentityConflict,
} from './favorites-reference-adapters';
import {
    normalizeContentMetadataPatch,
    XTREAM_FAVORITE_IDENTITY_CONFLICT,
} from '@iptvnator/shared/interfaces';

type XtreamRef = Extract<FavoriteReference, { provider: 'xtream' }>;
export class FavoritesXtreamAdapter {
    private readonly catalogs = new XtreamCollectionCatalog(
        (id) => this.client.contexts.get(id)?.sourceIncarnation
    );
    constructor(
        private readonly client: FavoritesSyncClient,
        private readonly enabled: () => boolean,
        private readonly sqlite: boolean,
        private readonly locks: {
            active(): boolean;
            withholdsEverything(): boolean;
            version(): number;
        }
    ) {}
    async project(
        raw: IXtreamDataSource,
        sourceId: string,
        hydrate = false,
        target?: XtreamRef
    ): Promise<XtreamFavoriteItem[]> {
        const assertCurrent = captureFavoriteOwner(this.client, sourceId);
        if (this.locks.withholdsEverything()) return [];
        const lockVersion = this.locks.version();
        const matchesTarget = (ref: XtreamRef) =>
            !target ||
            favoriteReferenceKey(ref) === favoriteReferenceKey(target);
        const local = (await raw.getFavorites(sourceId, hydrate)).filter(
            (item) => matchesTarget(xtreamFavoriteReference(item))
        );
        const catalogs = new Map<XtreamRef['kind'], XtreamContentItem[]>();
        const mapped = new Map(
            local.map((item) => [
                favoriteReferenceKey(xtreamFavoriteReference(item)),
                item,
            ])
        );
        let entries = (await this.client.entries(sourceId)).filter(
            ({ address }) =>
                address.content.provider === 'xtream' &&
                matchesTarget(address.content)
        );
        if (hydrate && !this.sqlite) {
            const kinds = new Set<XtreamRef['kind']>();
            for (const { address, record } of entries) {
                const state =
                    record.localOnly && record.local
                        ? record.local
                        : record.state;
                if (
                    address.content.provider === 'xtream' &&
                    state.member &&
                    !mapped.has(favoriteReferenceKey(address.content))
                )
                    kinds.add(address.content.kind);
            }
            if (kinds.size) {
                await Promise.all(
                    [...kinds].map(async (kind) =>
                        catalogs.set(
                            kind,
                            await this.catalogs.load(raw, sourceId, kind)
                        )
                    )
                );
                assertCurrent();
                entries = await this.client.entries(sourceId);
            }
        }
        const candidates = new Map<string, XtreamContentItem[]>();
        if (catalogs.size) {
            const wanted = new Set(
                entries.map(({ address }) =>
                    address.content.provider === 'xtream'
                        ? Number(address.content.id)
                        : 0
                )
            );
            for (const [kind, rows] of catalogs) {
                for (const row of rows) {
                    if (!wanted.has(row.xtream_id)) continue;
                    const key = `${kind}:${row.xtream_id}`;
                    const matches = candidates.get(key);
                    if (matches) matches.push(row);
                    else candidates.set(key, [row]);
                }
            }
        }
        for (const { address, record } of entries) {
            const ref = address.content;
            if (ref.provider !== 'xtream') continue;
            const key = favoriteReferenceKey(ref);
            const state =
                record.localOnly && record.local ? record.local : record.state;
            if (!state.member) {
                mapped.delete(key);
                continue;
            }
            const snapshot = state.snapshot;
            const identity = normalizeContentMetadataPatch({
                tmdbId: snapshot?.tmdbId ? Number(snapshot.tmdbId) : undefined,
                releaseYear: snapshot?.releaseYear
                    ? Number(snapshot.releaseYear)
                    : undefined,
            });
            const existing = mapped.get(key);
            let candidate = existing ?? null;
            if (!candidate && hydrate && !this.sqlite) {
                const matches = candidates.get(`${ref.kind}:${ref.id}`) ?? [];
                candidate =
                    matches.find(
                        (row) =>
                            !hasXtreamFavoriteIdentityConflict(
                                snapshot,
                                row,
                                true
                            )
                    ) ??
                    matches.find(
                        (row) =>
                            !hasXtreamFavoriteIdentityConflict(snapshot, row)
                    ) ??
                    matches[0] ??
                    null;
            } else if (!candidate) {
                candidate = this.sqlite
                    ? await raw.getContentByXtreamId(
                          Number(ref.id),
                          sourceId,
                          ref.kind,
                          identity ?? undefined,
                          undefined,
                          true
                      )
                    : await raw.getContentByXtreamId(
                          Number(ref.id),
                          sourceId,
                          ref.kind,
                          ...(identity ? [identity] : [])
                      );
            }
            if (!candidate && this.locks.active()) {
                mapped.delete(key);
                continue;
            }
            const conflict = hasXtreamFavoriteIdentityConflict(
                snapshot,
                candidate
            );
            mapped.set(key, {
                ...(candidate ?? {
                    title: snapshot?.title ?? '',
                    rating: '',
                    added: '',
                    poster_url: '',
                }),
                id: conflict ? null : (candidate?.id ?? null),
                category_id: conflict ? null : (candidate?.category_id ?? null),
                title: conflict
                    ? (snapshot?.title ?? '')
                    : (candidate?.title ?? snapshot?.title ?? ''),
                xtream_id: Number(ref.id),
                type: ref.kind,
                ...(snapshot?.tmdbId
                    ? { tmdb_id: Number(snapshot.tmdbId) }
                    : {}),
                ...(snapshot?.releaseYear
                    ? { release_year: Number(snapshot.releaseYear) }
                    : {}),
                catalog_status:
                    conflict || !candidate
                        ? 'unknown'
                        : (candidate.catalog_status ?? 'present'),
                ...(conflict
                    ? { catalog_missing_reason: 'identity_conflict' }
                    : {}),
            });
        }
        assertCurrent();
        return this.locks.withholdsEverything() ||
            this.locks.version() !== lockVersion
            ? []
            : [...mapped.values()];
    }
    async reference(
        raw: IXtreamDataSource,
        sourceId: string,
        target: XtreamCollectionRef
    ): Promise<XtreamRef> {
        if (typeof target !== 'number' && target.providerId != null)
            return xtreamFavoriteReference({
                type: target.type,
                xtream_id: target.providerId,
            });
        if (!this.sqlite && typeof target !== 'number')
            return xtreamFavoriteReference({
                type: target.type,
                xtream_id: target.id,
            });
        const id = typeof target === 'number' ? target : target.id;
        const candidates = (await raw.getFavorites(sourceId, false)).filter(
            (item) =>
                item.id === id &&
                (typeof target === 'number' || item.type === target.type)
        );
        if (candidates.length === 1)
            return xtreamFavoriteReference(candidates[0]);
        // Legacy row callers resolve only against their own cached catalog; never guess provider IDs.
        const catalog = (
            await Promise.all(
                (typeof target === 'number'
                    ? (['live', 'movie', 'series'] as const)
                    : [target.type]
                ).map((type) => raw.getCachedContent(sourceId, type))
            )
        )
            .reduce<XtreamContentItem[]>((all, rows) => all.concat(rows), [])
            .filter((item) => item.id === id);
        if (catalog.length !== 1)
            throw new Error('Unresolved favorite identity');
        return xtreamFavoriteReference(catalog[0]);
    }
    async invoke(raw: IXtreamDataSource, method: string, args: unknown[]) {
        if (method === 'getFavorites')
            return this.project(raw, String(args[0]), true);
        const [target, sourceId] = args as [XtreamCollectionRef, string];
        const assertCurrent = captureFavoriteOwner(this.client, sourceId);
        const ref = await this.reference(raw, sourceId, target);
        assertCurrent();
        const rows = await this.project(raw, sourceId, false, ref);
        assertCurrent();
        const current = rows.find(
            (item) =>
                favoriteReferenceKey(xtreamFavoriteReference(item)) ===
                favoriteReferenceKey(ref)
        );
        const identity =
            typeof target !== 'number' && target.identity
                ? normalizeContentMetadataPatch(target.identity)
                : null;
        const conflictsWith = (item?: XtreamFavoriteItem | null) =>
            !!item &&
            (!!(
                identity?.tmdbId &&
                item.tmdb_id &&
                identity.tmdbId !== Number(item.tmdb_id)
            ) ||
                !!(
                    identity?.releaseYear &&
                    item.release_year &&
                    identity.releaseYear !== Number(item.release_year)
                ));
        if (method === 'isFavorite')
            return (
                !!current &&
                current.catalog_missing_reason !== 'identity_conflict' &&
                !conflictsWith(current)
            );
        if (conflictsWith(current))
            throw new Error(XTREAM_FAVORITE_IDENTITY_CONFLICT);
        const member = method === 'addFavorite';
        const candidate = await raw.getContentByXtreamId(
            Number(ref.id),
            sourceId,
            ref.kind,
            ...(identity ? [identity] : [])
        );
        assertCurrent();
        if (
            member &&
            (current?.catalog_missing_reason === 'identity_conflict' ||
                candidate?.catalog_missing_reason === 'identity_conflict' ||
                conflictsWith(candidate))
        )
            throw new Error(XTREAM_FAVORITE_IDENTITY_CONFLICT);
        const snapshot =
            current || candidate || identity
                ? parseFavoriteSnapshot({
                      ...(current || candidate
                          ? xtreamFavoriteSnapshot(current ?? candidate!)
                          : {}),
                      ...(identity?.tmdbId
                          ? { tmdbId: String(identity.tmdbId) }
                          : {}),
                      ...(identity?.releaseYear
                          ? { releaseYear: String(identity.releaseYear) }
                          : {}),
                  })
                : undefined;
        if (this.enabled())
            await this.client.set(sourceId, ref, member, snapshot);
        else await this.client.setLocal(sourceId, ref, member, snapshot);
    }
}
