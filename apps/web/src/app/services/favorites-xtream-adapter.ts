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
    type FavoriteSnapshot,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { FavoritesSyncClient } from '@iptvnator/services/favorites-sync';
import { normalizeFavoriteTitle } from './favorites-reference-adapters';
import {
    normalizeContentMetadataPatch,
    XTREAM_FAVORITE_IDENTITY_CONFLICT,
} from '@iptvnator/shared/interfaces';

type XtreamRef = Extract<FavoriteReference, { provider: 'xtream' }>;
export function xtreamFavoriteReference(
    item: Pick<XtreamContentItem, 'type' | 'xtream_id'>
): XtreamRef {
    const kind = item.type === 'vod' ? 'movie' : item.type;
    if (
        !['live', 'movie', 'series'].includes(kind) ||
        !Number.isSafeInteger(item.xtream_id) ||
        item.xtream_id <= 0
    )
        throw new Error('Unresolved favorite identity');
    return {
        provider: 'xtream',
        kind: kind as XtreamRef['kind'],
        id: String(item.xtream_id),
    };
}
export function xtreamFavoriteSnapshot(item: XtreamFavoriteItem) {
    return parseFavoriteSnapshot({
        title: normalizeFavoriteTitle(item.title),
        ...(item.tmdb_id == null ? {} : { tmdbId: String(item.tmdb_id) }),
        ...(item.release_year == null
            ? {}
            : { releaseYear: String(item.release_year) }),
        ...(item.catalog_missing_reason === 'identity_conflict'
            ? { identityConflict: true }
            : {}),
    });
}
/** Shared identity guards also apply when exporting a retained local backup. */
export function hasXtreamFavoriteIdentityConflict(
    snapshot: FavoriteSnapshot | undefined,
    candidate?: Pick<
        XtreamFavoriteItem,
        'tmdb_id' | 'release_year' | 'catalog_missing_reason'
    > | null
): boolean {
    return !!(
        snapshot?.identityConflict ||
        candidate?.catalog_missing_reason === 'identity_conflict' ||
        (snapshot?.tmdbId &&
            candidate?.tmdb_id != null &&
            snapshot.tmdbId !== String(candidate.tmdb_id)) ||
        (snapshot?.releaseYear &&
            candidate?.release_year != null &&
            snapshot.releaseYear !== String(candidate.release_year))
    );
}
export class FavoritesXtreamAdapter {
    constructor(
        private readonly client: FavoritesSyncClient,
        private readonly enabled: () => boolean,
        private readonly sqlite: boolean
    ) {}
    async project(
        raw: IXtreamDataSource,
        sourceId: string
    ): Promise<XtreamFavoriteItem[]> {
        const local = await raw.getFavorites(sourceId);
        const mapped = new Map(
            local.map((item) => [
                favoriteReferenceKey(xtreamFavoriteReference(item)),
                item,
            ])
        );
        for (const { address, record } of await this.client.entries(sourceId)) {
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
            const existing = mapped.get(key);
            const candidate =
                existing ??
                (await raw.getContentByXtreamId(
                    Number(ref.id),
                    sourceId,
                    ref.kind
                ));
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
        return [...mapped.values()];
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
        const candidates = (await raw.getFavorites(sourceId)).filter(
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
            return this.project(raw, String(args[0]));
        const [target, sourceId] = args as [XtreamCollectionRef, string];
        const ref = await this.reference(raw, sourceId, target);
        const rows = await this.project(raw, sourceId);
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
            ref.kind
        );
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
