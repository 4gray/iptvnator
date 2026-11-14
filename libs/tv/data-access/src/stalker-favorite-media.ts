import {
    favoriteReferenceKey,
    stalkerFavoriteReference,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type { StalkerPortalItem } from '@iptvnator/shared/interfaces';
import type { StalkerPagedCatalog } from '@iptvnator/portal/stalker/client';
import { rows, text, type Kind, type Media } from '@iptvnator/tv/util';
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
    const find = (data: Record<string, unknown>[]) => {
        const matches = data
            .map((raw) =>
                toMedia(
                    type === 'radio' ? { ...raw, radio: 'true' } : raw,
                    kind
                )
            )
            .filter((candidate) => {
                const reference = stalkerMediaReference(candidate);
                if (!reference) return false;
                if (favoriteReferenceKey(reference) === key) return true;
                const streamId = text(candidate.raw.stream_id).trim();
                const alias =
                    streamId &&
                    stalkerFavoriteReference({
                        ...candidate.raw,
                        id: streamId,
                        favoriteContentType: type,
                    } as StalkerPortalItem);
                return alias && favoriteReferenceKey(alias) === key;
            });
        if (
            new Set(
                matches.map((match) =>
                    JSON.stringify([
                        text(match.raw.stream_id) || match.providerId,
                        text(match.raw.cmd),
                    ])
                )
            ).size > 1
        )
            throw new Error(
                'The provider returned ambiguous playback entries.'
            );
        return matches[0];
    };
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
        const match = find(rows(unwrap(response)));
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
                const match = find(result.data);
                if (match && (match.kind === 'series' || match.raw.cmd))
                    return attach(match);
                if (
                    !result.data.length ||
                    (page + 1) * result.pageSize >= result.total
                )
                    break;
            }
        }
    }
    throw new Error('Favorite is unavailable from its provider.');
}
