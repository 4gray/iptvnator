import type { CrossPortalSimilarItem } from '@iptvnator/services';
import type {
    TmdbEnrichedCastMember,
    VodDetailsItem,
} from '@iptvnator/shared/interfaces';

/**
 * Pure helpers resolving where the VOD details page's extras rows (cast &
 * crew, Similar rail) lead. The component owns the actual navigation.
 */

/**
 * Router commands of the actor page for a cast/crew member, inside the
 * item's own portal workspace. Null when the member has no TMDB person id
 * (names parsed from provider text): there is no actor page to open.
 */
export function buildVodActorRoute(
    item: VodDetailsItem,
    member: TmdbEnrichedCastMember
): (string | number)[] | null {
    if (!member.tmdbPersonId) {
        return null;
    }
    const basePath =
        item.type === 'stalker' ? '/workspace/stalker' : '/workspace/xtreams';
    return [basePath, item.playlistId, 'actor', member.tmdbPersonId];
}

/**
 * The cross-portal match behind a Similar-rail card. Rail keys are built by
 * `buildSimilarRailItems` (vod-details-presentation.ts) as
 * `x<playlistId>-<xtreamId>`.
 */
export function findSimilarByRailKey(
    items: readonly CrossPortalSimilarItem[],
    railKey: string
): CrossPortalSimilarItem | undefined {
    return items.find(
        (candidate) =>
            `x${candidate.match.playlistId}-${candidate.match.xtreamId}` ===
            railKey
    );
}
