import { favoriteReferenceKey } from '@iptvnator/shared/interfaces/favorites-sync';
import type { StalkerPagedCatalog } from '@iptvnator/portal/stalker/client';
import { rows, type Kind, type Media } from '@iptvnator/tv/util';
import { stalkerMediaReference } from './favorites-refs';
import type { StalkerSession } from './stalker-session';
import { unwrap } from './stalker-series';

export async function hydrateSharedStalker(
    item: Media,
    signal: AbortSignal,
    session: StalkerSession,
    pages: StalkerPagedCatalog,
    toMedia: (raw: Record<string, unknown>, kind: Kind) => Media
) {
    if (!item.raw.sharedReference || item.raw.cmd) return item;
    const ref = stalkerMediaReference(item);
    if (!ref) return item;
    const key = favoriteReferenceKey(ref);
    const type =
        ref.kind === 'live'
            ? 'itv'
            : ref.kind === 'radio'
              ? 'radio'
              : ref.mode === 'regular'
                ? 'series'
                : 'vod';
    const kind =
        type === 'itv' || type === 'radio'
            ? 'live'
            : type === 'series'
              ? 'series'
              : 'movie';
    const matches = new Map<string, Media>();
    function collect(data: Record<string, unknown>[]) {
        let direct: Media | undefined;
        for (const raw of data) {
            const candidate = toMedia(
                type === 'radio' ? { ...raw, radio: 'true' } : raw,
                kind
            );
            const canonical = stalkerMediaReference(candidate);
            const legacy = stalkerMediaReference(candidate, false);
            if (!canonical || !legacy) continue;
            const canonicalKey = favoriteReferenceKey(canonical);
            if (canonicalKey !== key && favoriteReferenceKey(legacy) !== key)
                continue;
            const previous = matches.get(canonicalKey);
            if (
                previous?.raw.cmd &&
                candidate.raw.cmd &&
                previous.raw.cmd !== candidate.raw.cmd
            )
                throw new Error(
                    'The provider returned ambiguous playback entries.'
                );
            if (!previous || candidate.raw.cmd)
                matches.set(canonicalKey, candidate);
            if (
                canonicalKey === key &&
                (candidate.kind === 'series' || candidate.raw.cmd)
            )
                direct = candidate;
        }
        return direct;
    }
    const attach = (match: Media) => ({
        ...item,
        ...match,
        id: item.id,
        raw: { ...match.raw, favoriteContentType: type, sharedReference: ref },
    });
    if (type === 'itv' || type === 'radio') {
        const response = await session
            .request({ type, action: 'get_all_channels' }, signal)
            .catch((error: unknown) => {
                if (signal.aborted) throw error;
                return undefined;
            });
        const match = collect(rows(unwrap(response)));
        if (match?.raw.cmd) return attach(match);
    }
    const category = item.category;
    const searches = item.title ? [item.title, ''] : [''];
    const scopes = category && category !== '*' ? [category, '*'] : ['*'];
    // shortcut: bound a provider scan when it ignores search; reopen the title from its catalog.
    for (const scope of scopes) {
        for (const search of searches) {
            for (let page = 0; page < 20; page++) {
                const result = await pages.load(
                    {
                        type,
                        category: scope,
                        genre: type === 'itv' && scope === '*' ? '0' : scope,
                        search,
                    },
                    page,
                    signal
                );
                const match = collect(result.data);
                if (match) return attach(match);
                if (
                    !result.data.length ||
                    (page + 1) * result.pageSize >= result.total
                ) {
                    if (!search && scope === '*' && matches.size === 1) {
                        const legacy = matches.values().next().value;
                        if (
                            legacy &&
                            (legacy.kind === 'series' || legacy.raw.cmd)
                        )
                            return attach(legacy);
                    }
                    break;
                }
            }
        }
    }
    throw new Error('Favorite is unavailable from its provider.');
}
