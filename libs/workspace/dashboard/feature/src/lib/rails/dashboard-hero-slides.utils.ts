import type {
    PortalActivityItem,
    PortalAddedItem,
    PortalFavoriteItem,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';

/** Slides the cinematic hero rotates through, at most. */
export const HERO_SLIDE_LIMIT = 4;

/** Auto-advance interval; the active dot fills over the same duration. */
export const HERO_ROTATION_MS = 8_000;

const HERO_LIVE_FAVORITE_CANDIDATES = 3;
const HERO_LIVE_RECENT_CANDIDATES = 2;

/**
 * Why a title is on the hero, which decides its eyebrow and actions:
 * - `continue` — unfinished movie/series from the recent history
 * - `live` — a favourite (or recently watched) channel with a programme on air
 * - `favorite` / `added` — discovery slides from favourites and Xtream imports
 * - `recent` — last-resort fallback: the most recent item of any kind, so a
 *   history with only guide-less live channels still gets a hero
 */
export type DashboardHeroSlideKind =
    'continue' | 'live' | 'favorite' | 'added' | 'recent';

export type DashboardHeroLiveCandidate =
    | { readonly origin: 'favorite'; readonly item: PortalFavoriteItem }
    | { readonly origin: 'recent'; readonly item: PortalRecentItem };

export type DashboardHeroSource =
    | { readonly kind: 'continue' | 'recent'; readonly item: PortalRecentItem }
    | ({ readonly kind: 'live' } & DashboardHeroLiveCandidate)
    | { readonly kind: 'favorite'; readonly item: PortalFavoriteItem }
    | { readonly kind: 'added'; readonly item: PortalAddedItem };

export interface DashboardHeroSourceInput {
    /** Unfinished movies/series, most recent first. */
    readonly continueItems: readonly PortalRecentItem[];
    /** The channel picked for the live slide, when one has a programme on air. */
    readonly live: DashboardHeroLiveCandidate | null;
    /**
     * Channels exist that could still fill the live slide (their EPG answer
     * may be pending). Its place is then kept free, so the slide arriving
     * late never pushes another one out from under the user.
     */
    readonly reserveLive: boolean;
    /** Favourite movies/series. */
    readonly favorites: readonly PortalFavoriteItem[];
    readonly recentlyAdded: readonly PortalAddedItem[];
    /** The newest history row, used only when nothing else qualifies. */
    readonly mostRecent: PortalRecentItem | null;
}

/** One title, whichever list it came from. */
export function dashboardHeroItemKey(
    item: Pick<PortalActivityItem, 'playlist_id' | 'type' | 'xtream_id' | 'id'>
): string {
    return `${item.playlist_id}::${item.type}::${item.xtream_id ?? item.id}`;
}

/**
 * Channels that may fill the live slide, in preference order: favourites
 * first (the slide is "your channel is on air"), then the channels watched
 * most recently. The live EPG presenter pins exactly these so their
 * programmes are looked up even when their rails are hidden or scrolled.
 */
export function selectDashboardHeroLiveCandidates(
    favoriteLive: readonly PortalFavoriteItem[],
    recentLive: readonly PortalRecentItem[]
): DashboardHeroLiveCandidate[] {
    const seen = new Set<string>();
    const candidates: DashboardHeroLiveCandidate[] = [];
    const add = (candidate: DashboardHeroLiveCandidate) => {
        const key = dashboardHeroItemKey(candidate.item);
        if (candidate.item.type !== 'live' || seen.has(key)) {
            return;
        }
        seen.add(key);
        candidates.push(candidate);
    };

    favoriteLive
        .slice(0, HERO_LIVE_FAVORITE_CANDIDATES)
        .forEach((item) => add({ origin: 'favorite', item }));
    recentLive
        .slice(0, HERO_LIVE_RECENT_CANDIDATES)
        .forEach((item) => add({ origin: 'recent', item }));
    return candidates;
}

/**
 * The rotation mix: the title to resume first, then a channel on air now,
 * then one favourite and one recent import; remaining places go to the next
 * unfinished title, favourite and import in turn. A title never appears
 * twice, and the order is stable so a slide arriving late (the live slide
 * waits for its EPG answer) slots in without reshuffling the rest. While
 * live candidates exist, one place stays reserved for the live slide, so
 * its arrival never evicts a slide the user may be viewing.
 */
export function pickDashboardHeroSources(
    input: DashboardHeroSourceInput
): DashboardHeroSource[] {
    const seen = new Set<string>();
    const sources: DashboardHeroSource[] = [];
    const limit =
        input.reserveLive && !input.live
            ? HERO_SLIDE_LIMIT - 1
            : HERO_SLIDE_LIMIT;
    const push = (source: DashboardHeroSource | null) => {
        if (!source || sources.length >= limit) {
            return;
        }
        const key = dashboardHeroItemKey(source.item);
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        sources.push(source);
    };
    const continueAt = (index: number) => {
        const item = input.continueItems[index];
        return item ? ({ kind: 'continue', item } as const) : null;
    };
    const favoriteAt = (index: number) => {
        const item = input.favorites[index];
        return item ? ({ kind: 'favorite', item } as const) : null;
    };
    const addedAt = (index: number) => {
        const item = input.recentlyAdded[index];
        return item ? ({ kind: 'added', item } as const) : null;
    };

    push(continueAt(0));
    push(input.live ? { kind: 'live', ...input.live } : null);
    push(favoriteAt(0));
    push(addedAt(0));
    // Ends once every list has run out; duplicates only skip a place.
    for (let index = 1; sources.length < limit; index++) {
        const next = [continueAt(index), favoriteAt(index), addedAt(index)];
        if (next.every((source) => source === null)) {
            break;
        }
        next.forEach(push);
    }

    if (sources.length === 0 && input.mostRecent) {
        push({ kind: 'recent', item: input.mostRecent });
    }
    return sources;
}
