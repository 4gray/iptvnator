import type {
    PortalAddedItem,
    PortalFavoriteItem,
    PortalRecentItem,
} from '@iptvnator/shared/interfaces';
import {
    dashboardHeroItemKey,
    HERO_SLIDE_LIMIT,
    pickDashboardHeroSources,
    selectDashboardHeroLiveCandidates,
    type DashboardHeroSourceInput,
} from './dashboard-hero-slides.utils';

const base = (
    id: number,
    type: 'live' | 'movie' | 'series',
    title: string
) => ({
    id,
    title,
    type,
    playlist_id: 'p',
    category_id: '1',
    xtream_id: id,
    source: 'xtream' as const,
});
const recent = (
    id: number,
    type: 'live' | 'movie' | 'series' = 'movie'
): PortalRecentItem => ({
    ...base(id, type, `recent-${id}`),
    viewed_at: '2026-09-01',
});
const favorite = (
    id: number,
    type: 'live' | 'movie' | 'series' = 'movie'
): PortalFavoriteItem => ({
    ...base(id, type, `favorite-${id}`),
    added_at: '2026-09-01',
});
const added = (id: number): PortalAddedItem => ({
    ...base(id, 'movie', `added-${id}`),
    added_at: '2026-09-01',
});

const input = (
    overrides: Partial<DashboardHeroSourceInput>
): DashboardHeroSourceInput => ({
    continueItems: [],
    live: null,
    reserveLive: false,
    favorites: [],
    recentlyAdded: [],
    mostRecent: null,
    ...overrides,
});

const summary = (sources: ReturnType<typeof pickDashboardHeroSources>) =>
    sources.map((source) => `${source.kind}:${source.item.title}`);

describe('pickDashboardHeroSources', () => {
    it('leads with the title to resume, then live, a favourite and an import', () => {
        const live = favorite(50, 'live');
        expect(
            summary(
                pickDashboardHeroSources(
                    input({
                        continueItems: [recent(1), recent(2)],
                        live: { origin: 'favorite', item: live },
                        favorites: [favorite(10), favorite(11)],
                        recentlyAdded: [added(20), added(21)],
                    })
                )
            )
        ).toEqual([
            'continue:recent-1',
            'live:favorite-50',
            'favorite:favorite-10',
            'added:added-20',
        ]);
    });

    it('fills the remaining places round-robin and never exceeds the limit', () => {
        const sources = pickDashboardHeroSources(
            input({
                continueItems: [recent(1), recent(2), recent(3)],
                favorites: [favorite(10)],
            })
        );

        expect(summary(sources)).toEqual([
            'continue:recent-1',
            'favorite:favorite-10',
            'continue:recent-2',
            'continue:recent-3',
        ]);
        expect(sources.length).toBeLessThanOrEqual(HERO_SLIDE_LIMIT);
    });

    it('features a title once even when it is both unfinished and a favourite', () => {
        const shared = recent(1);
        expect(
            summary(
                pickDashboardHeroSources(
                    input({
                        continueItems: [shared],
                        favorites: [{ ...shared, added_at: 'x' }, favorite(10)],
                    })
                )
            )
        ).toEqual(['continue:recent-1', 'favorite:favorite-10']);
    });

    it('keeps the order stable when the live slide arrives late', () => {
        const without = summary(
            pickDashboardHeroSources(
                input({
                    continueItems: [recent(1)],
                    favorites: [favorite(10)],
                })
            )
        );
        const withLive = summary(
            pickDashboardHeroSources(
                input({
                    continueItems: [recent(1)],
                    live: { origin: 'recent', item: recent(60, 'live') },
                    favorites: [favorite(10)],
                })
            )
        );

        expect(without).toEqual(['continue:recent-1', 'favorite:favorite-10']);
        expect(withLive).toEqual([
            'continue:recent-1',
            'live:recent-60',
            'favorite:favorite-10',
        ]);
    });

    it('keeps a place for a pending live slide so its arrival evicts nothing', () => {
        const lists = {
            continueItems: [recent(1), recent(2)],
            favorites: [favorite(10)],
            recentlyAdded: [added(20)],
        };
        const pending = summary(
            pickDashboardHeroSources(input({ ...lists, reserveLive: true }))
        );
        const arrived = summary(
            pickDashboardHeroSources(
                input({
                    ...lists,
                    reserveLive: true,
                    live: { origin: 'favorite', item: favorite(50, 'live') },
                })
            )
        );

        expect(pending).toEqual([
            'continue:recent-1',
            'favorite:favorite-10',
            'added:added-20',
        ]);
        // Every slide shown before the live answer is still there after it.
        expect(arrived).toEqual([
            'continue:recent-1',
            'live:favorite-50',
            'favorite:favorite-10',
            'added:added-20',
        ]);
        expect(
            summary(pickDashboardHeroSources(input({ ...lists })))
        ).toHaveLength(HERO_SLIDE_LIMIT);
    });

    it('falls back to the newest history row only when nothing else qualifies', () => {
        const channel = recent(70, 'live');
        expect(
            summary(pickDashboardHeroSources(input({ mostRecent: channel })))
        ).toEqual(['recent:recent-70']);
        expect(
            summary(
                pickDashboardHeroSources(
                    input({ mostRecent: channel, favorites: [favorite(10)] })
                )
            )
        ).toEqual(['favorite:favorite-10']);
        expect(pickDashboardHeroSources(input({}))).toEqual([]);
    });
});

describe('selectDashboardHeroLiveCandidates', () => {
    it('prefers favourites, adds recent channels and skips duplicates', () => {
        const candidates = selectDashboardHeroLiveCandidates(
            [
                favorite(1, 'live'),
                favorite(2, 'live'),
                favorite(3, 'live'),
                favorite(4, 'live'),
            ],
            [recent(2, 'live'), recent(5, 'live'), recent(6, 'live')]
        );

        expect(
            candidates.map(({ origin, item }) => `${origin}:${item.id}`)
        ).toEqual(['favorite:1', 'favorite:2', 'favorite:3', 'recent:5']);
    });

    it('ignores non-live rows', () => {
        expect(
            selectDashboardHeroLiveCandidates([favorite(1, 'movie')], [])
        ).toEqual([]);
    });
});

describe('dashboardHeroItemKey', () => {
    it('identifies a title across the lists it can come from', () => {
        expect(dashboardHeroItemKey(recent(1))).toBe(
            dashboardHeroItemKey(favorite(1))
        );
        expect(dashboardHeroItemKey(recent(1))).not.toBe(
            dashboardHeroItemKey(recent(1, 'series'))
        );
    });
});
