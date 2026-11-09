import { isLikelyM3uVod } from '@iptvnator/shared/m3u-utils';
import {
    favoriteReferenceKey,
    m3uFavoriteReference,
    parseFavoriteReference,
    parseFavoriteSnapshot,
    stalkerFavoriteReference,
    type FavoriteAddress,
    type FavoriteReference,
    type FavoriteSnapshot,
} from '@iptvnator/shared/interfaces/favorites-sync';
import {
    identity,
    rows,
    text,
    artwork,
    type Kind,
    type Media,
    type Source,
} from '@iptvnator/tv/util';

/** Episodes and local-only sources never produce a shared reference. */
export async function mediaFavoriteReference(
    item: Media,
    source: Source
): Promise<FavoriteReference | null> {
    if (item.kind === 'episode' || !source.libraryId) return null;
    try {
        const reference = await rawReference(item, source);
        return reference ? parseFavoriteReference(reference) : null;
    } catch {
        return null;
    }
}

async function rawReference(
    item: Media,
    source: Source
): Promise<FavoriteReference | null> {
    if (source.provider === 'xtream') {
        if (!['live', 'movie', 'series'].includes(item.kind)) return null;
        return {
            provider: 'xtream',
            kind: item.kind as 'live' | 'movie' | 'series',
            id: item.providerId,
        };
    }
    if (source.provider === 'stalker')
        return stalkerFavoriteReference({
            ...item.raw,
            favoriteContentType:
                (item.raw.favoriteContentType as string) ??
                (item.raw.origin as string),
        } as never);
    if (source.provider === 'm3u' && item.providerId)
        return m3uFavoriteReference(item.providerId);
    return null;
}

export function mediaFavoriteSnapshot(
    item: Media,
    reference?: FavoriteReference
): FavoriteSnapshot {
    const episodes =
        reference?.provider === 'stalker' &&
        reference.kind === 'series' &&
        reference.mode === 'embedded' &&
        Array.isArray(item.raw.series)
            ? rows(item.raw.series)
                  .map((value) => Number(value))
                  .filter(
                      (value) => Number.isSafeInteger(value) && value >= 0
                  )
            : undefined;
    try {
        return parseFavoriteSnapshot({
            title: item.title || undefined,
            ...(item.category ? { categoryId: item.category } : {}),
            ...(item.metadata?.tmdbId
                ? { tmdbId: String(item.metadata.tmdbId) }
                : {}),
            ...(item.year && /^[0-9]+$/.test(item.year)
                ? { releaseYear: item.year }
                : {}),
            ...(episodes ? { episodes } : {}),
        });
    } catch {
        /* Out-of-contract titles still share; they only lose metadata. */
        return {};
    }
}

/** The requested catalog kind encoded in a Stalker media identity. */
function stalkerCatalogKind(
    reference: Extract<FavoriteReference, { provider: 'stalker' }>
): Kind {
    if (reference.kind === 'series')
        return reference.mode === 'regular' ? 'series' : 'movie';
    return reference.kind === 'movie' ? 'movie' : 'live';
}

/** Minimal provider row fields so saved Stalker commands resolve identically. */
function stalkerRaw(
    reference: Extract<FavoriteReference, { provider: 'stalker' }>,
    snapshot?: FavoriteSnapshot
): Record<string, unknown> {
    const id = reference.id;
    const kind = reference.kind;
    if (kind === 'series')
        return {
            id,
            movie_id: id,
            ...(reference.mode === 'embedded'
                ? { series: snapshot?.episodes ?? [] }
                : {}),
            ...(reference.mode === 'lazy' ? { is_series: true } : {}),
            stream_type: 'movie',
            origin: 'vod',
            favoriteContentType: 'vod',
            category_id: 'vod',
        };
    if (kind === 'movie')
        return {
            id,
            movie_id: id,
            stream_type: 'movie',
            origin: 'vod',
            favoriteContentType: 'vod',
            category_id: 'vod',
        };
    return {
        id,
        stream_id: id,
        stream_type: 'live',
        origin: 'itv',
        favoriteContentType: kind === 'radio' ? 'radio' : 'itv',
        category_id: kind === 'radio' ? 'radio' : 'itv',
        ...(kind === 'radio' ? { radio: 'true' } : {}),
    };
}

/**
 * Rebuilds a playable TV item from a shared favorite. Provider detail and
 * episode hydration happen through the normal open/play paths; an M3U item
 * additionally needs its playlist URL matched by hash.
 */
export function resolveFavoriteMedia(
    source: Source,
    address: FavoriteAddress,
    snapshot?: FavoriteSnapshot
): Media | null {
    const reference = address.content;
    const title = snapshot?.title ?? '';
    if (reference.provider === 'xtream')
        return {
            id: identity(source, reference.kind, reference.id),
            sourceId: source.id,
            providerId: reference.id,
            kind: reference.kind,
            title,
            category: snapshot?.categoryId,
            year: snapshot?.releaseYear,
            raw: {},
        };
    if (reference.provider === 'stalker') {
        const catalogKind = stalkerCatalogKind(reference);
        return {
            id: identity(
                source,
                reference.kind === 'radio' ? 'live' : reference.kind,
                `${catalogKind}:${reference.id}`
            ),
            sourceId: source.id,
            providerId: reference.id,
            kind: reference.kind === 'radio' ? 'live' : reference.kind,
            title,
            category: snapshot?.categoryId,
            year: snapshot?.releaseYear,
            raw: stalkerRaw(reference, snapshot),
        };
    }
    return null;
}

/**
 * M3U identity is one-way hashed; indexing hashes every playlist URL once so
 * each shared favorite costs a single lookup instead of a full scan.
 */
export async function m3uFavoriteIndex(
    items: Record<string, unknown>[]
): Promise<Map<string, Record<string, unknown>>> {
    const index = new Map<string, Record<string, unknown>>();
    for (const raw of items) {
        const url = text(raw.url);
        if (url) index.set((await m3uFavoriteReference(url)).urlHash, raw);
    }
    return index;
}

export function resolveM3uFavoriteMedia(
    source: Source,
    address: FavoriteAddress,
    index: Map<string, Record<string, unknown>>
): Media | null {
    if (address.content.provider !== 'm3u') return null;
    const raw = index.get(address.content.urlHash);
    const url = raw && text(raw.url);
    if (!raw || !url) return null;
    const kind = isLikelyM3uVod({ url, radio: raw.radio as string })
        ? 'movie'
        : 'live';
    const tvg = (raw.tvg ?? {}) as Record<string, unknown>;
    return {
        id: identity(source, kind, url),
        sourceId: source.id,
        providerId: url,
        kind,
        title: text(raw.name),
        category: text((raw.group as { title?: string })?.title),
        categoryName: text((raw.group as { title?: string })?.title),
        poster: artwork(tvg.logo),
        raw,
    };
}

export { favoriteReferenceKey };
